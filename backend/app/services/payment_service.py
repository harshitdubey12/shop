from __future__ import annotations

import logging
import os
import time
import uuid
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.booking import Booking
from app.models.marketplace import SalonBooking, RefundLog, FinancialActionLog
from app.models.vendor import Vendor
from app.money import compute_split_from_vendor_paise, rupees_to_paise
from app.services import razorpay_service, metrics_service

logger = logging.getLogger(__name__)


def validate_financial_invariant(booking: Booking, next_action_paise: int = 0, action_type: str = "read"):
    """
    Guarantees the financial invariant: payment = transferred + refunded.
    Phases 1, 5, 6, 7 implementation.
    """
    # Phase 7: FINALIZED bookings are immutable
    if booking.status == "FINALIZED" and action_type not in ["read", "audit"]:
        raise RuntimeError(f"Action blocked: Booking {booking.id} is FINALIZED.")

    # Phase 1: BLOCK if mismatch detected (unless repairing)
    if booking.integrity_status == "mismatch_detected" and action_type != "repair":
        raise RuntimeError(f"Action blocked: Booking {booking.id} has detected mismatch. Repair required.")
    
    # Phase 1: BLOCK if pending verification
    if booking.integrity_status == "pending_verification" and action_type not in ["read", "repair", "sync"]:
        raise RuntimeError(f"Action blocked: Booking {booking.id} is pending verification.")

    current_total = booking.total_transferred_amount_paise + booking.total_refunded_amount_paise
    
    # Phase 6: RELAXED invariant applies during INITIATED states
    # Do NOT block actions based on temporary mismatch during INITIATED states
    is_initiated = "_INITIATED" in booking.status
    
    # Phase 1: Pre-action guard - Check if invariant would break AFTER action
    if action_type in ["transfer", "refund"] and not is_initiated:
        if current_total + next_action_paise > booking.payment_amount_paise:
            booking.integrity_status = "mismatch_detected"
            booking.severity_level = "CRITICAL"
            metrics_service.send_financial_alert(
                "invariant_at_risk",
                {"booking_id": booking.id, "current": current_total, "action": next_action_paise, "limit": booking.payment_amount_paise}
            )
            raise RuntimeError(f"Financial invariant risk: Action would exceed payment amount for {booking.id}")

    # Phase 5: STRICT invariant applies ONLY when TRANSFER_COMPLETED or REFUNDED
    if booking.status in ["TRANSFER_COMPLETED", "REFUNDED"]:
        if booking.payment_amount_paise != current_total:
            booking.integrity_status = "mismatch_detected"
            booking.severity_level = "CRITICAL"
            metrics_service.send_financial_alert(
                "financial_invariant_violation",
                {
                    "booking_id": booking.id,
                    "payment_amount": booking.payment_amount_paise,
                    "transferred": booking.total_transferred_amount_paise,
                    "refunded": booking.total_refunded_amount_paise,
                    "state": booking.status
                }
            )
            # Hard block further actions
            raise RuntimeError(f"Financial invariant violation for booking {booking.id}")
    
    # Phase 11: Precision & Remainder tracking
    booking.remaining_amount_paise = booking.payment_amount_paise - current_total

    # Phase 7: Move to FINALIZED if settlement complete
    if booking.remaining_amount_paise == 0 and booking.status in ["TRANSFER_COMPLETED", "REFUNDED"]:
        booking.status = "FINALIZED"
        booking.integrity_status = "valid"
        booking.severity_level = "LOW"


def _inr_str_from_paise(paise: int) -> str:
    return str((Decimal(paise) / Decimal(100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


async def create_route_booking_checkout(
    db: Session,
    settings: Settings,
    *,
    vendor_id: str,
    base_price_inr: Decimal,
) -> tuple[Booking, dict]:
    """
    Server-side pricing only. Creates Razorpay order (amount only) and booking row.
    Route transfer runs from webhook after capture.
    """
    if not settings.razorpay_route_enabled:
        raise ValueError("Route mode disabled")

    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise ValueError("vendor not found")
    if vendor.verification_status != "approved":
        raise ValueError("vendor not approved for payments")
    acc = (vendor.razorpay_account_id or "").strip()
    if not acc.startswith("acc_"):
        raise ValueError("vendor has no razorpay linked account id")

    vendor_paise = rupees_to_paise(base_price_inr)
    if vendor_paise < 100:
        raise ValueError("base price too low for Route transfers (min vendor share 100 paise)")

    split = compute_split_from_vendor_paise(vendor_paise, settings.platform_commission_paise)

    booking_id = str(uuid.uuid4())
    booking = Booking(
        id=booking_id,
        created_at=int(time.time()),
        vendor_id=vendor.id,
        base_price_inr=str(base_price_inr.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)),
        platform_fee_inr=_inr_str_from_paise(split.platform_commission_paise),
        total_amount_inr=_inr_str_from_paise(split.total_amount_paise),
        vendor_payout_inr=_inr_str_from_paise(split.vendor_amount_paise),
        base_price_paise=split.vendor_amount_paise,
        platform_fee_paise=split.platform_commission_paise,
        total_amount_paise=split.total_amount_paise,
        vendor_payout_paise=split.vendor_amount_paise,
        payment_amount_paise=split.total_amount_paise, # Phase 4
        total_transferred_amount_paise=0,
        total_refunded_amount_paise=0,
        status="PAYMENT_CREATED",
    )
    db.add(booking)
    db.flush()

    notes = {"booking_id": booking.id, "vendor_id": vendor.id}
    try:
        order = await razorpay_service.create_order_plain(
            settings,
            amount_paise=split.total_amount_paise,
            currency="INR",
            receipt=booking.id[:40],
            notes=notes,
        )
    except Exception:
        db.rollback()
        raise

    oid = order.get("id")
    if not isinstance(oid, str):
        db.rollback()
        raise RuntimeError("invalid order response")

    booking.razorpay_order_id = oid
    booking.status = "ORDER_CREATED"
    db.add(booking)
    db.commit()
    db.refresh(booking)
    return booking, order


def get_booking_by_order_id(db: Session, order_id: str) -> Booking | None:
    return db.scalars(select(Booking).where(Booking.razorpay_order_id == order_id)).first()


async def finalize_route_split_for_booking(
    db: Session,
    settings: Settings,
    booking_id: str,
    payment_id: str,
    *,
    payment_entity: dict | None = None,
) -> Booking:
    """
    After customer pays: capture if needed, transfer vendor share, mark booking paid.
    Uses pessimistic locking to prevent double transfers.
    """
    # Acquire explicit row lock
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise ValueError("Booking not found")

    from app import failure_injection
    failure_injection.inject_db_failure("db_deadlock")

    # Phase 2: Operation Lock with Stale Recovery
    if booking.financial_operation_lock:
         now = int(time.time())
         acquired_at = booking.financial_lock_acquired_at or 0
         if now - acquired_at > 60:
             logger.warning(f"stale_lock_detected for booking {booking.id}. Override allowed.")
         else:
             raise RuntimeError(f"Action blocked: Financial operation already in progress for {booking.id}.")

    # Phase 1: Pre-action invariant guard
    validate_financial_invariant(booking, next_action_paise=booking.total_amount_paise, action_type="transfer")

    # Phase 2: Set Operation Lock with acquired_at
    booking.financial_operation_lock = True
    booking.financial_lock_acquired_at = int(time.time())
    db.flush()

    # Phase 1 & 2 blocks
    if "REFUND" in booking.status:
        booking.financial_operation_lock = False
        db.commit()
        raise ValueError(f"Cannot process transfer: booking {booking.id} is in refund state {booking.status}")

    if booking.status in ["TRANSFER_COMPLETED", "TRANSFER_INITIATED", "FINALIZED"]:
        booking.financial_operation_lock = False
        db.commit()
        return booking

    vendor = db.get(Vendor, booking.vendor_id)
    if not vendor or not (vendor.razorpay_account_id or "").startswith("acc_"):
        booking.status = "TRANSFER_FAILED"
        booking.transfer_error = "vendor missing linked account"
        metrics_service.send_financial_alert("transfer_failed", {"booking_id": booking.id, "reason": "missing_account"})
        db.add(booking)
        db.commit()
        return booking

    pay = payment_entity
    if pay is None:
        pay = await razorpay_service.fetch_payment(settings, payment_id)

    oid = pay.get("order_id")
    if oid and booking.razorpay_order_id and oid != booking.razorpay_order_id:
        booking.status = "TRANSFER_FAILED"
        booking.transfer_error = f"order_id mismatch webhook={oid} booking={booking.razorpay_order_id}"
        metrics_service.send_financial_alert("transfer_failed", {"booking_id": booking.id, "reason": "order_mismatch"})
        db.add(booking)
        db.commit()
        return booking

    amt = int(pay.get("amount", 0))
    if amt != booking.total_amount_paise:
        booking.status = "TRANSFER_FAILED"
        booking.transfer_error = f"amount mismatch pay={amt} booking={booking.total_amount_paise}"
        metrics_service.send_financial_alert("transfer_failed", {"booking_id": booking.id, "reason": "amount_mismatch"})
        db.add(booking)
        db.commit()
        return booking

    # Mark PAYMENT_CAPTURED and flush to DB, holding the lock
    booking.status = "PAYMENT_CAPTURED"
    booking.razorpay_payment_id = payment_id
    booking.payment_amount_paise = amt
    db.flush()

    from app import failure_injection
    failure_injection.inject_db_failure("after_write")

    # Transition to TRANSFER_INITIATED
    booking.status = "TRANSFER_INITIATED"
    db.flush()

    # Phase 1: External Action Journaling
    action_id = str(uuid.uuid4())
    action_log = FinancialActionLog(
        id=action_id,
        booking_id=booking.id,
        action_type="transfer",
        status="INITIATED",
        idempotency_key=f"tr_{booking.id}_{int(time.time())}",
        created_at=int(time.time()),
        updated_at=int(time.time())
    )
    db.add(action_log)
    db.flush()

    try:
        _, tr = await razorpay_service.capture_then_route_transfers(
            settings,
            payment_id=payment_id,
            total_amount_paise=booking.total_amount_paise,
            vendor_account_id=vendor.razorpay_account_id,
            vendor_payout_paise=booking.vendor_payout_paise,
        )
        # Phase 1: Update log to CONFIRMED after API success
        action_log.status = "CONFIRMED"
        if isinstance(tr, dict) and tr.get("items") and isinstance(tr["items"], list):
            booking.razorpay_transfer_id = tr["items"][0].get("id")
            action_log.external_id = booking.razorpay_transfer_id
            booking.total_transferred_amount_paise = booking.total_amount_paise
        action_log.updated_at = int(time.time())
    except razorpay_service.RazorpayAPIError as e:
        # Phase 1: Update log to FAILED if API fails
        action_log.status = "FAILED"
        action_log.updated_at = int(time.time())
        logger.error("Route split failed booking=%s payment=%s: %s", booking.id, payment_id, e)
        booking.status = "TRANSFER_FAILED"
        booking.transfer_error = str(e)[:4000]
        metrics_service.send_financial_alert("transfer_failed", {"booking_id": booking.id, "error": str(e)})
        db.add(booking)
        db.commit()
        return booking

    booking.status = "TRANSFER_COMPLETED"
    booking.transfer_error = None
    
    # Phase 1: Step 4-6: RELOAD + RELOCK + Re-check
    db.flush()
    db.refresh(booking)
    # Re-acquire lock for final check
    booking = db.query(Booking).filter(Booking.id == booking.id).with_for_update().first()
    
    try:
        validate_financial_invariant(booking, action_type="transfer")
    except Exception as e:
        # Phase 1: Rule: If invariant fails at step 5: abort commit, mark mismatch, enqueue repair
        booking.integrity_status = "mismatch_detected"
        booking.severity_level = "CRITICAL"
        booking.financial_operation_lock = False
        db.flush()
        from app.worker import repair_booking_integrity_task
        if hasattr(repair_booking_integrity_task, "delay"):
            repair_booking_integrity_task.delay(booking.id)
        else:
            # Fallback for chaos testing/dummy environments
            pass
        raise e

    # Phase 2: Clear Lock
    booking.financial_operation_lock = False
    booking.financial_lock_acquired_at = None
    
    db.add(booking)

    try:
        # Phase 1 Chaos: Fail before final commit
        from app import failure_injection
        failure_injection.inject_db_failure("before_commit")
        db.commit()
        failure_injection.inject_db_failure("after_commit")
    except Exception as e:
        db.rollback()
        # Ensure lock is cleared if we can still talk to DB
        try:
            # We need a new session or reset this one to clear the lock
            # but in this context we'll just re-raise and let the caller handle
            pass
        except: pass
        raise e
        
    db.refresh(booking)
    return booking


async def initiate_refund(
    db: Session,
    settings: Settings,
    booking_id: str,
    amount_paise: int,
    reason: str,
    idempotency_key: str | None = None,
) -> RefundLog:
    """
    Strictly initiate a refund. Checks state machine and invariant.
    """
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise ValueError("Booking not found")

    from app import failure_injection
    failure_injection.inject_db_failure("db_deadlock")

    # Phase 2: Operation Lock with Stale Recovery
    if booking.financial_operation_lock:
         now = int(time.time())
         acquired_at = booking.financial_lock_acquired_at or 0
         if now - acquired_at > 60:
             logger.warning(f"stale_lock_detected for booking {booking.id}. Override allowed.")
         else:
             raise RuntimeError(f"Action blocked: Financial operation already in progress for {booking.id}.")

    # Phase 1: Pre-action invariant guard
    validate_financial_invariant(booking, next_action_paise=amount_paise, action_type="refund")

    # Phase 2: Set Operation Lock with acquired_at
    booking.financial_operation_lock = True
    booking.financial_lock_acquired_at = int(time.time())
    db.flush()

    # Hard Blocks (Phase 1)
    if "TRANSFER" in booking.status and booking.status != "TRANSFER_FAILED":
        # Rule: If state contains TRANSFER_* -> block refund
        # Exception: if it's failed, we might allow refund if we haven't actually transferred money.
        # But user says: "If state contains TRANSFER_* -> block refund"
        booking.financial_operation_lock = False
        db.commit()
        raise ValueError(f"Cannot refund: booking {booking.id} has transfer status {booking.status}")

    # Double Refund Protection (Phase 2)
    if idempotency_key:
        existing = db.scalars(select(RefundLog).where(RefundLog.idempotency_key == idempotency_key)).first()
        if existing:
            booking.financial_operation_lock = False
            db.commit()
            return existing

    # Amount validation (Phase 7)
    if booking.total_refunded_amount_paise + amount_paise > booking.payment_amount_paise:
        raise ValueError("Refund amount exceeds payment amount")

    # Transition to REFUND_INITIATED
    booking.status = "REFUND_INITIATED"
    db.flush()

    from app import failure_injection
    failure_injection.inject_db_failure("after_write")

    refund_id = str(uuid.uuid4())
    refund_log = RefundLog(
        id=refund_id,
        booking_id=booking.id,
        payment_id=booking.razorpay_payment_id,
        amount_paise=amount_paise,
        reason=reason,
        status="initiated",
        idempotency_key=idempotency_key,
        created_at=int(time.time()),
    )
    db.add(refund_log)
    db.flush()

    # Phase 1: External Action Journaling
    action_id = str(uuid.uuid4())
    action_log = FinancialActionLog(
        id=action_id,
        booking_id=booking.id,
        action_type="refund",
        status="INITIATED",
        idempotency_key=idempotency_key or f"ref_{booking.id}_{int(time.time())}",
        created_at=int(time.time()),
        updated_at=int(time.time())
    )
    db.add(action_log)
    db.flush()

    try:
        rzp_refund = await razorpay_service.refund_payment(
            settings,
            payment_id=booking.razorpay_payment_id,
            amount_paise=amount_paise
        )
        # Phase 1: Update log to CONFIRMED after API success
        action_log.status = "CONFIRMED"
        action_log.external_id = rzp_refund.get("id")
        action_log.updated_at = int(time.time())

        refund_log.razorpay_refund_id = action_log.external_id
        refund_log.status = "completed"
        
        # Update booking totals
        booking.total_refunded_amount_paise += amount_paise
        if booking.total_refunded_amount_paise == booking.payment_amount_paise:
            booking.status = "REFUNDED"
        else:
            booking.status = "PARTIALLY_REFUNDED"
            
        # Phase 1: Step 4-6: RELOAD + RELOCK + Re-check
        db.flush()
        db.refresh(booking)
        booking = db.query(Booking).filter(Booking.id == booking.id).with_for_update().first()
        
        try:
            validate_financial_invariant(booking, action_type="refund")
        except Exception as e:
            booking.integrity_status = "mismatch_detected"
            booking.severity_level = "CRITICAL"
            booking.financial_operation_lock = False
            db.flush()
            from app.worker import repair_booking_integrity_task
            if hasattr(repair_booking_integrity_task, "delay"):
                repair_booking_integrity_task.delay(booking.id)
            else:
                pass
            raise e
            
    except razorpay_service.RazorpayAPIError as e:
        # Phase 1: Update log to FAILED if API fails
        action_log.status = "FAILED"
        action_log.updated_at = int(time.time())
        logger.error("Refund failed booking=%s: %s", booking.id, e)
        refund_log.status = "failed"
        booking.status = "REFUND_FAILED"
        metrics_service.send_financial_alert("refund_failure", {"booking_id": booking.id, "error": str(e)})
    
    # Phase 2: Clear Lock
    booking.financial_operation_lock = False
    booking.financial_lock_acquired_at = None

    try:
        # Phase 1 Chaos: Fail before final commit
        from app import failure_injection
        failure_injection.inject_db_failure("before_commit")
        db.commit()
        failure_injection.inject_db_failure("after_commit")
    except Exception as e:
        db.rollback()
        raise e

    db.refresh(booking)
    return refund_log


async def repair_booking_integrity(db: Session, settings: Settings, booking_id: str, dry_run: bool = True) -> dict:
    """
    Phase 3, 4, 6: core repair_booking_integrity engine with Circuit Breaker, DB-level locks, 
    and Sandbox mode.
    Auto-fixes mismatches by syncing with Razorpay truth.
    """
    # Phase 4: Atomic Flow with DB-level repair lock
    booking = db.query(Booking).filter(Booking.id == booking_id).with_for_update().first()
    if not booking:
        raise ValueError("Booking not found")

    # Phase 4: Debounce (Phase 4 Rule: allow max 1 repair trigger per booking per 30 seconds)
    now = int(time.time())
    last_trigger = booking.last_repair_triggered_at or 0
    if now - last_trigger < 30 and not dry_run:
        return {"ok": False, "reason": "Repair debounced (anti-storm)"}
    
    booking.last_repair_triggered_at = now
    db.flush()

    # Phase 4: Atomic Check
    if booking.repair_in_progress:
        return {"ok": False, "reason": "Repair already in progress (DB lock)"}
    
    # Phase 3: Circuit Breaker
    if booking.repair_attempt_count >= 3:
        booking.status = "FINANCIAL_LOCKED"
        booking.integrity_status = "mismatch_detected"
        booking.severity_level = "CRITICAL"
        db.commit()
        metrics_service.send_financial_alert("repair_circuit_breaker", {"booking_id": booking.id, "attempts": booking.repair_attempt_count})
        return {"ok": False, "reason": "FINANCIAL_LOCKED: Too many repair attempts. Admin intervention required."}

    # Phase 4: Set Atomic Lock
    booking.repair_in_progress = True
    if not dry_run:
        booking.repair_attempt_count += 1
    booking.last_repair_at = now
    db.flush()

    if not booking.razorpay_payment_id:
        booking.repair_in_progress = False
        db.commit()
        return {"ok": False, "reason": "No payment_id to sync from"}

    repair_logs = []
    
    try:
        # 1. Fetch Razorpay Truth
        pay = await razorpay_service.fetch_payment(settings, booking.razorpay_payment_id)
        # status_rzp = pay.get("status")
        amt_rzp = int(pay.get("amount", 0))

        # 2. Sync Amounts
        if booking.payment_amount_paise != amt_rzp:
            repair_logs.append(f"Plan: Fixed payment_amount: {booking.payment_amount_paise} -> {amt_rzp}")
            if not dry_run:
                booking.payment_amount_paise = amt_rzp

        # 3. Sync Transfers
        transfers_resp = await razorpay_service.fetch_payment_transfers(settings, booking.razorpay_payment_id)
        tr_items = transfers_resp.get("items", [])
        if tr_items and booking.total_transferred_amount_paise == 0:
            repair_logs.append(f"Plan: Fixed total_transferred: 0 -> {booking.total_amount_paise}")
            if not dry_run:
                booking.total_transferred_amount_paise = booking.total_amount_paise
                booking.razorpay_transfer_id = tr_items[0].get("id")
                if booking.status == "TRANSFER_FAILED":
                    booking.status = "TRANSFER_COMPLETED"

        # 4. Sync Refunds
        refunds_resp = await razorpay_service.fetch_payment_refunds(settings, booking.razorpay_payment_id)
        ref_items = refunds_resp.get("items", [])
        actual_ref_amt = sum(int(ref.get("amount", 0)) for ref in ref_items if ref.get("status") == "processed")
        
        if booking.total_refunded_amount_paise != actual_ref_amt:
            repair_logs.append(f"Plan: Fixed total_refunded: {booking.total_refunded_amount_paise} -> {actual_ref_amt}")
            if not dry_run:
                booking.total_refunded_amount_paise = actual_ref_amt
            
            # Ensure RefundLog entries exist
            for ref in ref_items:
                if ref.get("status") != "processed": continue
                rid = ref.get("id")
                existing = db.scalars(select(RefundLog).where(RefundLog.razorpay_refund_id == rid)).first()
                if not existing:
                    repair_logs.append(f"Plan: Create missing RefundLog for {rid}")
                    if not dry_run:
                        new_ref = RefundLog(
                            id=str(uuid.uuid4()),
                            booking_id=booking.id,
                            payment_id=booking.razorpay_payment_id,
                            amount_paise=int(ref.get("amount", 0)),
                            reason="auto_repair_sync",
                            status="completed",
                            razorpay_refund_id=rid,
                            created_at=int(time.time())
                        )
                        db.add(new_ref)

        # 5. Correct Terminal State
        if booking.total_refunded_amount_paise >= booking.payment_amount_paise:
            if booking.status not in ["REFUNDED", "FINALIZED"]:
                repair_logs.append(f"Plan: Fixed status: {booking.status} -> REFUNDED")
                if not dry_run:
                    booking.status = "REFUNDED"
        elif booking.total_transferred_amount_paise > 0:
            if booking.status not in ["TRANSFER_COMPLETED", "FINALIZED"]:
                repair_logs.append(f"Plan: Fixed status: {booking.status} -> TRANSFER_COMPLETED")
                if not dry_run:
                    booking.status = "TRANSFER_COMPLETED"
        
        # 6. Re-validate Invariant
        validate_financial_invariant(booking, action_type="repair")
        
        if not dry_run:
            booking.repair_attempted = True
            booking.repair_log = (booking.repair_log or "") + f"\n[{int(time.time())}] Repair run (EXECUTE): {'; '.join(repair_logs)}"
            
            # Phase 6: Ensure log trace exists for repair
            repair_log = FinancialActionLog(
                id=str(uuid.uuid4()),
                booking_id=booking.id,
                action_type="repair",
                status="COMPLETED",
                idempotency_key=f"repair_{booking.id}_{now}",
                created_at=now,
                updated_at=now
            )
            db.add(repair_log)
        else:
            booking.repair_log = (booking.repair_log or "") + f"\n[{int(time.time())}] Repair run (DRY_RUN): {'; '.join(repair_logs)}"

        # Phase 4: Release Atomic Lock
        booking.repair_in_progress = False
        db.commit()
        return {"ok": True, "repairs": repair_logs, "dry_run": dry_run}

    except Exception as e:
        # Phase 4: Release Atomic Lock on failure
        booking.repair_in_progress = False
        db.commit()
        logger.exception(f"Repair failed for {booking_id}: {e}")
        return {"ok": False, "error": str(e)}


async def create_phase1_platform_fee_checkout(
    db: Session,
    settings: Settings,
    *,
    salon_booking: SalonBooking,
) -> dict[str, object]:
    """
    Phase 1: Razorpay order for platform fee only. Service amount is paid at shop (cash/UPI).
    """
    amount = int(salon_booking.platform_fee_paise)
    notes = {
        "salon_booking_id": salon_booking.id,
        "payment_phase": "1",
        "kind": "platform_fee_only",
    }
    order = await razorpay_service.create_order_plain(
        settings,
        amount_paise=amount,
        currency="INR",
        receipt=salon_booking.id[:40],
        notes={k: str(v) for k, v in notes.items()},
    )
    oid = order.get("id")
    if not isinstance(oid, str):
        raise RuntimeError("invalid Razorpay order response")

    salon_booking.razorpay_order_id = oid
    salon_booking.updated_at = int(time.time())
    db.add(salon_booking)
    db.commit()
    db.refresh(salon_booking)
    return {
        "salon_booking_id": salon_booking.id,
        "razorpay_order_id": oid,
        "amount_paise": amount,
        "currency": "INR",
        "razorpay_key_id": settings.razorpay_key_id,
    }
