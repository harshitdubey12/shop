import os
import time
import asyncio
import logging
import uuid
from typing import Any

try:
    from celery import Celery
    from celery.schedules import crontab
except ImportError:
    # Chaos mode/Test mode fallback
    from unittest.mock import MagicMock
    class Celery:
        def __init__(self, *args, **kwargs):
            self.conf = MagicMock()
        def task(self, *args, **kwargs):
            def decorator(f):
                import asyncio
                from app import failure_injection
                def wrapper(*w_args, **w_kwargs):
                    # Phase 1: Propagation
                    profile = w_kwargs.pop("_failure_profile", None)
                    if profile:
                        failure_injection.set_chaos_profile(profile)
                        
                    # Phase 3: Celery Chaos
                    if failure_injection.inject_celery_failure("duplicate_overlap"):
                        async def run_twice():
                            await asyncio.gather(
                                asyncio.to_thread(f, *w_args, **w_kwargs),
                                asyncio.to_thread(f, *w_args, **w_kwargs)
                            )
                        asyncio.run(run_twice())
                        return
                        
                    if failure_injection.inject_celery_failure("delayed_retry"):
                        res = f(*w_args, **w_kwargs)
                        time.sleep(2) # delay
                        f(*w_args, **w_kwargs) # phantom retry after success
                        return res
                        
                    if failure_injection.inject_celery_failure("retry_storm"):
                        async def storm():
                            tasks = [asyncio.to_thread(f, *w_args, **w_kwargs) for _ in range(10)]
                            await asyncio.gather(*tasks)
                        asyncio.run(storm())
                        return

                    return f(*w_args, **w_kwargs)
                    
                def delay_wrapper(*a, **kw):
                    # Propagate current context to kwargs for the task payload
                    kw["_failure_profile"] = failure_injection.chaos_context.get()
                    return wrapper(*a, **kw)
                    
                wrapper.delay = delay_wrapper
                return wrapper
            
            if len(args) == 1 and callable(args[0]):
                return decorator(args[0])
            return decorator
    class crontab:
        def __init__(self, *args, **kwargs): pass
    logger = logging.getLogger(__name__)
    logger.warning("Celery not found, using dummy tasks for chaos testing")

from sqlalchemy.orm import Session
from sqlalchemy import select, update

from app.config import get_settings
try:
    from app.db.session import SessionLocal
except ImportError:
    # Handle the function vs global variable naming in different environments
    from app.db.session import get_session_local
    SessionLocal = get_session_local
from app.models.marketplace import SlotHold, ReminderJob, WaitlistEntry, SalonBooking, RefundLog
from app.models.vendor import Vendor
from app.models.booking import Booking
from app.services import razorpay_service, metrics_service
from redis import Redis
import logging

logger = logging.getLogger(__name__)

settings = get_settings()

redis_client = Redis.from_url(os.environ.get("REDIS_URL", "redis://localhost:6379/0"))

def get_reco_lock(lock_name: str, expire: int = 600) -> bool:
    """Phase 6: Idempotent execution lock."""
    from app import failure_injection
    mode = failure_injection.inject_redis_failure("redis_failure_mode")
    
    if mode == "lock_unpersisted":
        return True # Thinks it has lock, but isn't persisted
    if mode == "split_brain":
        # Dual positive response
        redis_client.set(f"lock:reco:{lock_name}", "1", ex=expire) # override
        return True
    if mode == "early_expiry":
        return bool(redis_client.set(f"lock:reco:{lock_name}", "1", ex=1, nx=True))
    if mode == "lock_disappears":
        acquired = bool(redis_client.set(f"lock:reco:{lock_name}", "1", ex=expire, nx=True))
        if acquired:
            # Simulate it dropping mid-operation async
            import threading
            threading.Timer(0.1, lambda: redis_client.delete(f"lock:reco:{lock_name}")).start()
        return acquired

    return bool(redis_client.set(f"lock:reco:{lock_name}", "1", ex=expire, nx=True))

def release_reco_lock(lock_name: str):
    redis_client.delete(f"lock:reco:{lock_name}")

celery_app = Celery(
    "worker",
    broker=os.environ.get("CELERY_BROKER_URL", "redis://localhost:6379/0"),
    backend=os.environ.get("CELERY_RESULT_BACKEND", "redis://localhost:6379/0")
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
)

# --- Beat Schedule ---
celery_app.conf.beat_schedule = {
    "expire-stale-holds-every-30-seconds": {
        "task": "app.worker.expire_stale_holds",
        "schedule": 30.0,
    },
    "send-reminders-every-minute": {
        "task": "app.worker.send_booking_reminders",
        "schedule": 60.0,
    },
    "recompute-trust-scores-nightly": {
        "task": "app.worker.recompute_trust_scores",
        "schedule": crontab(hour=3, minute=0),
    },
    "reconciliation-short-loop": {
        "task": "app.worker.reconciliation_short_loop",
        "schedule": 300.0,
    },
    "reconciliation-mid-loop": {
        "task": "app.worker.reconciliation_mid_loop",
        "schedule": 3600.0,
    },
    "reconciliation-long-loop": {
        "task": "app.worker.reconciliation_long_loop",
        "schedule": crontab(hour=4, minute=0),
    },
    "global-financial-reconciliation-hourly": {
        "task": "app.worker.global_financial_reconciliation",
        "schedule": 3600.0,
    },
    "verify-booking-integrity-every-15-minutes": {
        "task": "app.worker.verify_booking_integrity",
        "schedule": 900.0,
    },
}

@celery_app.task
def repair_booking_integrity_task(booking_id: str, dry_run: bool = True):
    """
    Phase 8, 6: Safe auto-repair execution with Sandbox mode.
    """
    # Distributed lock to ensure only ONE repair per booking at a time
    lock_key = f"lock:repair:{booking_id}"
    from app import failure_injection
    lock_acquired = True
    mode = failure_injection.inject_redis_failure("redis_failure_mode")
    
    if mode == "lock_unpersisted":
        pass
    elif mode == "split_brain":
        redis_client.set(lock_key, "1", ex=300)
    elif mode == "early_expiry":
        lock_acquired = bool(redis_client.set(lock_key, "1", ex=1, nx=True))
    elif mode == "lock_disappears":
        lock_acquired = bool(redis_client.set(lock_key, "1", ex=300, nx=True))
        if lock_acquired:
            import threading
            threading.Timer(0.1, lambda: redis_client.delete(lock_key)).start()
    else:
        lock_acquired = bool(redis_client.set(lock_key, "1", ex=300, nx=True))
        
    if not lock_acquired:
        return

    db: Session = SessionLocal()
    try:
        from app.services.payment_service import repair_booking_integrity
        import asyncio
        loop = asyncio.get_event_loop()
        loop.run_until_complete(repair_booking_integrity(db, settings, booking_id, dry_run=dry_run))
    finally:
        db.close()
        redis_client.delete(lock_key)


@celery_app.task
def reconciliation_short_loop(dry_run: bool = False):
    """
    SHORT LOOP (every 5 minutes):
    detect: PAYMENT_CAPTURED > 10 min with no action
    """
    if not get_reco_lock("short_loop"):
        return
    db: Session = SessionLocal()
    try:
        now = int(time.time())
        ten_min_ago = now - 600
        stuck_bookings = db.scalars(
            select(Booking).where(
                Booking.status == "PAYMENT_CAPTURED",
                Booking.created_at < ten_min_ago
            ).limit(100)
        ).all()
        
        for b in stuck_bookings:
            metrics_service.send_financial_alert(
                "stuck_payment_captured",
                {"booking_id": b.id, "created_at": b.created_at, "severity": "warning"}
            )
            if not dry_run:
                # Proactively try to finalize
                from app.services.payment_service import finalize_route_split_for_booking
                loop = asyncio.get_event_loop()
                loop.run_until_complete(
                    finalize_route_split_for_booking(db, settings, b.id, b.razorpay_payment_id)
                )
    finally:
        db.close()
        release_reco_lock("short_loop")


@celery_app.task
def reconciliation_mid_loop(dry_run: bool = False):
    """
    MID LOOP (every 1 hour):
    detect: stuck in INITIATED states
    """
    if not get_reco_lock("mid_loop"):
        return
    db: Session = SessionLocal()
    try:
        now = int(time.time())
        hour_ago = now - 3600
        stuck_bookings = db.scalars(
            select(Booking).where(
                Booking.status.in_(["TRANSFER_INITIATED", "REFUND_INITIATED"]),
                Booking.created_at < hour_ago
            ).limit(100)
        ).all()
        
        for b in stuck_bookings:
            metrics_service.send_financial_alert(
                "stuck_initiated_state",
                {"booking_id": b.id, "status": b.status, "severity": "critical"}
            )
            if not dry_run:
                # Reconciliation from Razorpay API
                loop = asyncio.get_event_loop()
                # Here we would call verify_payment_integrity and fix the state
                pass
    finally:
        db.close()
        release_reco_lock("mid_loop")


@celery_app.task
def reconciliation_long_loop(dry_run: bool = False):
    """
    LONG LOOP (daily):
    full audit
    """
    if not get_reco_lock("long_loop", expire=3600):
        return
    db: Session = SessionLocal()
    try:
        # Full audit logic here...
        pass
    finally:
        db.close()
        release_reco_lock("long_loop")


@celery_app.task
def verify_booking_integrity():
    """
    Continuously verifies correctness of bookings and money flow.
    Runs every 15 minutes.
    """
    db: Session = SessionLocal()
    try:
        # 1. Run Anomaly Detection
        metrics_service.check_for_anomalies(db, settings)

        # 2. Verify Bookings
        # We check bookings that are not already marked 'valid' or were recently updated.
        bookings = db.scalars(
            select(Booking).where(Booking.integrity_status != "valid").limit(500)
        ).all()

        for b in bookings:
            mismatches = []
            
            # Rule: If PAYMENT_CAPTURED: must have either TRANSFER_COMPLETED or RefundLog entry
            if b.status == "PAYMENT_CAPTURED":
                # Check if there's a refund log
                refund = db.scalars(select(RefundLog).where(RefundLog.booking_id == b.id)).first()
                if not refund:
                    mismatches.append("PAYMENT_CAPTURED but no TRANSFER_COMPLETED or RefundLog")

            # Rule: If TRANSFER_COMPLETED: verify transfer_id exists
            if b.status == "TRANSFER_COMPLETED":
                if not b.razorpay_transfer_id:
                    mismatches.append("TRANSFER_COMPLETED but missing razorpay_transfer_id")

            # Rule: If CANCELLED_DUE_TO_CONFLICT: verify refund exists
            if b.status == "CANCELLED_DUE_TO_CONFLICT":
                refund = db.scalars(select(RefundLog).where(RefundLog.booking_id == b.id)).first()
                if not refund:
                    mismatches.append("CANCELLED_DUE_TO_CONFLICT but no RefundLog entry")

            # Cross-check with Razorpay for critical states
            if b.status in ["PAYMENT_CAPTURED", "TRANSFER_COMPLETED", "CANCELLED_DUE_TO_CONFLICT"]:
                # Fetch vendor for account id
                vendor = db.get(Vendor, b.vendor_id)
                expected_acc = vendor.razorpay_account_id if vendor else None
                
                # Use the new cross-check service
                import asyncio
                # Celery tasks are sync by default, but our service is async
                loop = asyncio.get_event_loop()
                verification = loop.run_until_complete(
                    razorpay_service.verify_payment_integrity(
                        settings,
                        payment_id=b.razorpay_payment_id,
                        expected_amount_paise=b.total_amount_paise,
                        expected_transfer_account=expected_acc if b.status == "TRANSFER_COMPLETED" else None,
                        expected_transfer_amount=b.vendor_payout_paise if b.status == "TRANSFER_COMPLETED" else None
                    )
                )
                
                if not verification["valid"]:
                    mismatches.extend(verification["mismatches"])

            # Finalize Integrity Status
            if mismatches:
                b.integrity_status = "mismatch_detected"
                b.severity_level = "HIGH"
                b.manual_review_required = 1
                logger.critical(
                    f"INTEGRITY_MISMATCH booking_id={b.id} mismatches={mismatches}"
                )
                # Phase 8: Auto-enqueue repair
                repair_booking_integrity_task.delay(b.id)
            else:
                b.integrity_status = "valid"
                b.severity_level = "LOW"
                b.manual_review_required = 0
        
        db.commit()
    except Exception as e:
        logger.exception(f"Error in verify_booking_integrity: {e}")
        db.rollback()
    finally:
        db.close()


@celery_app.task
def global_financial_reconciliation():
    """
    Phase 5: System-level check.
    SUM(all payments) = SUM(all transfers) + SUM(all refunds)
    """
    db: Session = SessionLocal()
    try:
        total_payments = db.scalar(select(func.sum(Booking.payment_amount_paise))) or 0
        total_transferred = db.scalar(select(func.sum(Booking.total_transferred_amount_paise))) or 0
        total_refunded = db.scalar(select(func.sum(Booking.total_refunded_amount_paise))) or 0
        
        if total_payments != (total_transferred + total_refunded):
             logger.critical(
                f"global_financial_mismatch: payments={total_payments} vs "
                f"settled={total_transferred + total_refunded} (tr={total_transferred}, ref={total_refunded})"
            )
             metrics_service.send_financial_alert(
                 "global_financial_mismatch",
                 {"payments": total_payments, "transferred": total_transferred, "refunded": total_refunded}
             )
    finally:
        db.close()
    """Expire slot holds where TTL is passed."""
    db: Session = SessionLocal()
    try:
        now_unix = int(time.time())
        stmt = (
            update(SlotHold)
            .where(SlotHold.status == "active", SlotHold.expires_at_unix < now_unix)
            .values(status="expired")
        )
        db.execute(stmt)
        db.commit()
    finally:
        db.close()

@celery_app.task
def send_booking_reminders():
    """Send reminders via FCM based on ReminderJob."""
    db: Session = SessionLocal()
    try:
        now_unix = int(time.time())
        jobs = db.scalars(
            select(ReminderJob)
            .where(ReminderJob.status == "pending", ReminderJob.run_at_unix <= now_unix)
            .limit(100)
        ).all()
        for job in jobs:
            # FCM sending logic here
            job.status = "sent"
        db.commit()
    finally:
        db.close()

@celery_app.task
def process_waitlist(salon_booking_id: str):
    """Process waitlist when a booking is cancelled."""
    db: Session = SessionLocal()
    try:
        booking = db.get(SalonBooking, salon_booking_id)
        if not booking or booking.lifecycle_status != "cancelled":
            return
            
        entries = db.scalars(
            select(WaitlistEntry)
            .where(
                WaitlistEntry.vendor_id == booking.vendor_id,
                WaitlistEntry.slot_start_unix == booking.slot_start_unix,
                WaitlistEntry.status == "waiting"
            )
            .order_by(WaitlistEntry.created_at.asc())
        ).all()
        
        if entries:
            first_entry = entries[0]
            first_entry.status = "offered"
            # Send notification to first_entry.user_id
            db.commit()
    finally:
        db.close()

@celery_app.task
def recompute_trust_scores():
    """Nightly recomputation of Barber Trust Scores based on completed/cancelled bookings."""
    db: Session = SessionLocal()
    try:
        vendors = db.scalars(select(Vendor)).all()
        for vendor in vendors:
            # Recompute logic based on historical data
            # Example:
            vendor.punctuality_score = 98.0
        db.commit()
    finally:
        db.close()

import asyncio
import time
from sqlalchemy import or_
from app.models.booking import Booking

@celery_app.task
def retry_failed_transfers():
    """Poll for TRANSFER_FAILED (or stalled PAYMENT_CAPTURED) bookings and safely retry."""
    db: Session = SessionLocal()
    now = int(time.time())
    try:
        failed_bookings = db.scalars(
            select(Booking)
            .where(
                or_(
                    Booking.status == "TRANSFER_FAILED",
                    (Booking.status == "PAYMENT_CAPTURED") & (Booking.created_at < now - 900)
                )
            )
            .with_for_update(skip_locked=True)
            .limit(50)
        ).all()
        
        if not failed_bookings:
            return
            
        from app.services.payment_service import finalize_route_split_for_booking
        from app.config import get_settings
        settings = get_settings()
        
        # We must run async code in sync celery worker via asyncio
        loop = asyncio.get_event_loop()
        for booking in failed_bookings:
            if booking.razorpay_payment_id:
                try:
                    loop.run_until_complete(
                        finalize_route_split_for_booking(
                            db, 
                            settings, 
                            booking.id, 
                            booking.razorpay_payment_id
                        )
                    )
                except Exception as e:
                    # Logs already handle the error in finalize_route_split
                    pass
    finally:
        db.close()

import json
import logging
logger = logging.getLogger(__name__)

@celery_app.task
def daily_reconciliation_check():
    """Verify that all captured money is either transferred or refunded."""
    db: Session = SessionLocal()
    now = int(time.time())
    twenty_four_hours_ago = now - 86400
    try:
        stuck_bookings = db.scalars(
            select(Booking)
            .where(
                Booking.status == "PAYMENT_CAPTURED",
                Booking.created_at < twenty_four_hours_ago
            )
        ).all()
        
        mismatches = 0
        for b in stuck_bookings:
            refund = db.scalars(select(RefundLog).where(RefundLog.booking_id == b.id)).first()
            if not refund:
                logger.error(json.dumps({
                    "event": "financial_mismatch_detected",
                    "severity": "CRITICAL",
                    "booking_id": b.id,
                    "payment_id": b.razorpay_payment_id,
                    "amount_paise": b.total_amount_paise,
                    "reason": "Trapped in escrow without refund or transfer"
                }))
                mismatches += 1
        return {"checked": len(stuck_bookings), "mismatches": mismatches}
    except Exception as e:
        logger.exception("Error in daily_reconciliation_check")
    finally:
        db.close()
