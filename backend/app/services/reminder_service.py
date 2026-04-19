"""
WhatsApp first reminders for India, SMS fallback, push for last mile.

Schedules T minus 24h, T minus 2h, T minus 30m. Worker polls due rows, retries with backoff by moving run_at_unix forward.
"""
from __future__ import annotations

import logging
import random
import time
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.marketplace import ReminderJob, SalonBooking

logger = logging.getLogger(__name__)

REMINDER_PLANS: list[tuple[int, str, str]] = [
    (24 * 3600, "whatsapp", "booking_t24h_whatsapp"),
    (2 * 3600, "whatsapp", "booking_t2h_whatsapp"),
    (15 * 60, "push", "booking_t15m_push"),
]


def schedule_default_reminders(db: Session, sb: SalonBooking) -> None:
    now = int(time.time())
    for offset_sec, channel, template in REMINDER_PLANS:
        run_at = sb.slot_start_unix - offset_sec
        if run_at <= now:
            continue
        db.add(
            ReminderJob(
                id=str(uuid.uuid4()),
                salon_booking_id=sb.id,
                channel=channel,
                run_at_unix=run_at,
                status="pending",
                template=template,
                retry_count=0,
                max_retries=4,
                next_attempt_unix=None,
            )
        )
    db.commit()


def due_reminders(db: Session, *, now: int | None = None, limit: int = 50) -> list[ReminderJob]:
    now = now or int(time.time())
    return list(
        db.scalars(
            select(ReminderJob)
            .where(ReminderJob.status == "pending", ReminderJob.run_at_unix <= now)
            .order_by(ReminderJob.run_at_unix.asc())
            .limit(limit)
        )
    )


def dispatch_reminder_stub(job: ReminderJob, booking: SalonBooking | None) -> None:
    """Mock implementation for WhatsApp Business Cloud API, Twilio SMS, FCM."""
    logger.info(
        "DISPATCH_REMINDER: Executing %s reminder for booking=%s, vendor=%s via channel=%s",
        job.template,
        job.salon_booking_id,
        booking.vendor_id if booking else "?",
        job.channel
    )
    
    if job.channel == "whatsapp":
        # Mock Twilio/Meta WhatsApp API payload
        payload = {
            "messaging_product": "whatsapp",
            "to": booking.customer_phone_masked if booking else "unknown",
            "type": "template",
            "template": {
                "name": job.template,
                "language": {"code": "en"}
            }
        }
        logger.info(f"WhatsApp API Payload Mock: {payload}")
    elif job.channel in ["sms", "push"]:
        # Mock FCM/SMS payload
        payload = {
            "to": booking.user_id if booking else "unknown",
            "notification": {
                "title": "Upcoming Appointment",
                "body": f"Your appointment is in {job.template.split('_')[1]}."
            }
        }
        logger.info(f"FCM/SMS API Payload Mock: {payload}")


def mark_reminder_sent(db: Session, job: ReminderJob) -> None:
    job.status = "sent"
    job.next_attempt_unix = None
    job.last_error = None
    db.add(job)
    db.commit()


def mark_reminder_failed_with_retry(db: Session, job: ReminderJob, err: str, *, now: int | None = None) -> None:
    now = now or int(time.time())
    job.retry_count += 1
    job.last_error = err[:500]
    if job.retry_count >= job.max_retries:
        job.status = "failed"
    else:
        backoff = min(900, 20 * (2**job.retry_count) + random.randint(0, 15))
        job.run_at_unix = now + backoff
        job.status = "pending"
    db.add(job)
    db.commit()
    logger.warning("reminder retry scheduled id=%s retry=%s err=%s", job.id, job.retry_count, err)


def process_due_reminders(db: Session, *, limit: int = 50, simulate_failure_rate: float = 0.0) -> dict[str, Any]:
    """Worker entrypoint: send or fail with retry. simulate_failure_rate for tests only."""
    now = int(time.time())
    jobs = due_reminders(db, now=now, limit=limit)
    sent = 0
    scheduled_retry = 0
    failed_terminal = 0
    for job in jobs:
        booking = db.get(SalonBooking, job.salon_booking_id)
        try:
            if simulate_failure_rate > 0 and random.random() < simulate_failure_rate:
                raise RuntimeError("simulated provider failure")
            dispatch_reminder_stub(job, booking)
            mark_reminder_sent(db, job)
            sent += 1
        except Exception as exc:  # noqa: BLE001
            mark_reminder_failed_with_retry(db, job, str(exc), now=now)
            db.refresh(job)
            if job.status == "failed":
                failed_terminal += 1
            else:
                scheduled_retry += 1
    return {
        "sent": sent,
        "scheduled_retry": scheduled_retry,
        "failed_terminal": failed_terminal,
        "examined": len(jobs),
    }
