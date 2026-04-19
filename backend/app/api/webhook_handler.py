from __future__ import annotations

import json
import logging
import time
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.config import Settings, get_settings
from app.db.session import get_db
from app.models.marketplace import SalonBooking, IdempotencyKey, PaymentLedger, RefundLog
from app.services import razorpay_service, metrics_service
from app.services.payment_service import finalize_route_split_for_booking, get_booking_by_order_id, validate_financial_invariant
import uuid

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/razorpay", tags=["razorpay-webhooks"])

@router.post("/webhook")
async def razorpay_webhook(
    request: Request,
    db: Session = Depends(get_db),
    settings: Settings = Depends(get_settings),
) -> dict[str, Any]:
    raw = await request.body()
    sig = request.headers.get("X-Razorpay-Signature")
    if not razorpay_service.verify_webhook_signature(raw, sig, settings.razorpay_webhook_secret):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid webhook signature")

    event_id = request.headers.get("X-Razorpay-Event-Id", str(uuid.uuid4()))

    try:
        body = json.loads(raw.decode("utf-8"))
        # Phase 1: Webhook metadata propagation
        if "failure_profile" in body:
            from app.failure_injection import set_chaos_profile
            set_chaos_profile(body["failure_profile"])
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="invalid json body") from e

    return await handle_razorpay_webhook_event(db, settings, body, event_id)


async def handle_razorpay_webhook_event(db: Session, settings: Settings, body: dict, event_id: str) -> dict[str, Any]:
    # Idempotency Check
    idem_key = db.get(IdempotencyKey, event_id)
    if idem_key:
        return {"ok": True, "ignored": True, "reason": "idempotent request"}

    event = body.get("event")
    if event == "payment.captured":
        ent = body.get("payload", {}).get("payment", {}).get("entity") or {}
        pay_id = ent.get("id")
        order_id = ent.get("order_id")
        if not pay_id or not order_id:
            return {"ok": True, "ignored": True, "reason": "missing payment or order id"}

        # Phase 1 marketplace: platform fee only
        sb = db.scalars(select(SalonBooking).where(SalonBooking.razorpay_order_id == str(order_id))).first()
        if sb is not None:
            amt = int(ent.get("amount", 0))
            if amt == sb.platform_fee_paise:
                sb.payment_status = "platform_fee_paid"
                sb.lifecycle_status = "confirmed"
                sb.updated_at = int(time.time())
                
                # Append to Ledger
                ledger_entry = PaymentLedger(
                    id=str(uuid.uuid4()),
                    created_at=int(time.time()),
                    booking_id=sb.id,
                    vendor_id=sb.vendor_id,
                    user_id=sb.user_id,
                    amount_paise=amt,
                    transaction_type="platform_fee",
                    razorpay_payment_id=pay_id
                )
                db.add(ledger_entry)
                
                # Save Idempotency
                db.add(IdempotencyKey(
                    key=event_id,
                    created_at=int(time.time()),
                    user_id=sb.user_id,
                    request_path="/razorpay/webhook",
                    response_status=200
                ))
                
                db.add(sb)
                try:
                    db.commit()
                except IntegrityError:
                    db.rollback()
                    logger.error("ExcludeConstraint conflict on webhook capture for booking %s", sb.id)
                    sb.lifecycle_status = "cancelled_due_to_conflict"
                    sb.payment_status = "refunded"
                    db.add(sb)
                    res = await razorpay_service.refund_payment(settings, pay_id, amt)
                    
                    refund_log = RefundLog(
                        id=str(uuid.uuid4()),
                        booking_id=sb.id,
                        payment_id=pay_id,
                        amount_paise=amt,
                        reason="conflict_refund",
                        status="completed",
                        razorpay_refund_id=res.get("id"),
                        created_at=int(time.time())
                    )
                    db.add(refund_log)
                    db.commit()
                    return {"ok": True, "event": event, "handled": "refunded_due_to_conflict"}
                    
                return {"ok": True, "event": event, "handled": "salon_phase1_fee"}

        booking = get_booking_by_order_id(db, str(order_id))
        if not booking:
            logger.info("webhook payment.captured for unknown order_id=%s", order_id)
            return {"ok": True, "ignored": True, "reason": "unknown order"}
        
        await finalize_route_split_for_booking(db, settings, booking.id, pay_id, payment_entity=ent)
        
        # Save Idempotency
        db.add(IdempotencyKey(
            key=event_id,
            created_at=int(time.time()),
            user_id="system",
            request_path="/razorpay/webhook",
            response_status=200
        ))
        db.commit()
        return {"ok": True, "event": event}

    if event == "transfer.processed":
        ent = body.get("payload", {}).get("transfer", {}).get("entity") or {}
        tr_id = ent.get("id")
        pay_id = ent.get("source") # transfer.source is payment_id
        if not tr_id or not pay_id:
            return {"ok": True, "ignored": True}
        
        from app.models.booking import Booking
        booking = db.query(Booking).filter(Booking.razorpay_payment_id == str(pay_id)).with_for_update().first()
        if booking:
            # Phase 5: Precedence Rules - If booking already in FINAL STATE, ignore conflicting webhook updates
            if booking.status == "FINALIZED":
                return {"ok": True, "ignored": True, "reason": "Booking is FINALIZED"}

            # Reconcile Truth
            booking.status = "TRANSFER_COMPLETED"
            booking.razorpay_transfer_id = tr_id
            booking.total_transferred_amount_paise = booking.total_amount_paise
            validate_financial_invariant(booking, action_type="sync")
            db.commit()
            
            # Phase 9: Event-Driven Reconciliation
            from app.worker import repair_booking_integrity_task
            repair_booking_integrity_task.delay(booking.id)
            
            return {"ok": True, "event": event, "reconciled": True}

    if event == "transfer.failed":
        ent = body.get("payload", {}).get("transfer", {}).get("entity") or {}
        pay_id = ent.get("source")
        if booking := db.scalars(select(Booking).where(Booking.razorpay_payment_id == str(pay_id))).with_for_update().first():
            if booking.status == "FINALIZED":
                return {"ok": True, "ignored": True}
            
            booking.status = "TRANSFER_FAILED"
            booking.transfer_error = ent.get("error_description") or "transfer.failed webhook"
            metrics_service.send_financial_alert("transfer_failed", {"booking_id": booking.id, "error": booking.transfer_error})
            db.commit()
            
            # Phase 9: Event-Driven Reconciliation
            from app.worker import repair_booking_integrity_task
            repair_booking_integrity_task.delay(booking.id)
            
            return {"ok": True, "event": event}

    if event == "refund.processed":
        ent = body.get("payload", {}).get("refund", {}).get("entity") or {}
        ref_id = ent.get("id")
        pay_id = ent.get("payment_id")
        amt = int(ent.get("amount", 0))
        
        from app.models.booking import Booking
        booking = db.scalars(select(Booking).where(Booking.razorpay_payment_id == str(pay_id))).with_for_update().first()
        if booking:
            if booking.status == "FINALIZED":
                 return {"ok": True, "ignored": True}

            # Check if RefundLog exists, if not create (Source of Truth Reconciliation)
            refund_log = db.scalars(select(RefundLog).where(RefundLog.razorpay_refund_id == str(ref_id))).first()
            if not refund_log:
                refund_log = RefundLog(
                    id=str(uuid.uuid4()),
                    booking_id=booking.id,
                    payment_id=pay_id,
                    amount_paise=amt,
                    reason="webhook_reconciliation",
                    status="completed",
                    razorpay_refund_id=ref_id,
                    created_at=int(time.time())
                )
                db.add(refund_log)
                booking.total_refunded_amount_paise += amt
            
            if booking.total_refunded_amount_paise == booking.payment_amount_paise:
                booking.status = "REFUNDED"
            else:
                booking.status = "PARTIALLY_REFUNDED"
            
            # Phase 11: Auto-correct DB from webhook truth
            validate_financial_invariant(booking, action_type="sync")
            db.commit()
            
            # Phase 9: Event-Driven Reconciliation
            from app.worker import repair_booking_integrity_task
            repair_booking_integrity_task.delay(booking.id)
            
            return {"ok": True, "event": event, "reconciled": True}

    if event == "refund.failed":
        ent = body.get("payload", {}).get("refund", {}).get("entity") or {}
        ref_id = ent.get("id")
        if refund_log := db.scalars(select(RefundLog).where(RefundLog.razorpay_refund_id == str(ref_id))).first():
            refund_log.status = "failed"
            metrics_service.send_financial_alert("refund_failure", {"refund_id": ref_id, "booking_id": refund_log.booking_id})
            db.commit()
            return {"ok": True, "event": event}

    if event == "order.paid":
        order_ent = body.get("payload", {}).get("order", {}).get("entity") or {}
        order_id = order_ent.get("id")
        if not order_id:
            return {"ok": True, "ignored": True, "reason": "missing order id"}
        booking = get_booking_by_order_id(db, str(order_id))
        if not booking:
            return {"ok": True, "ignored": True, "reason": "unknown order"}
        data = await razorpay_service.fetch_order_payments(settings, str(order_id))
        items = data.get("items") or []
        captured = next((p for p in items if isinstance(p, dict) and p.get("status") == "captured"), None)
        if not captured or not captured.get("id"):
            logger.info("order.paid webhook but no captured payment yet order=%s", order_id)
            return {"ok": True, "ignored": True, "reason": "no captured payment on order"}
        pay_id = str(captured["id"])
        await finalize_route_split_for_booking(db, settings, booking.id, pay_id, payment_entity=captured)
        return {"ok": True, "event": event}

    return {"ok": True, "ignored": True, "event": event}
