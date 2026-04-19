"""Weekly economics and marketplace health (conversion proxy from SQL)."""
from __future__ import annotations

import time
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.controlled_marketplace import Dispute, VendorReview
from app.models.marketplace import SalonBooking, RefundLog
from app.models.booking import Booking

logger = logging.getLogger(__name__)
def _week_bounds(week_offset: int = 0) -> tuple[int, int]:
    now = int(time.time())
    week = 7 * 86400
    end = now - week_offset * week
    start = end - week
    return start, end


def weekly_marketplace_snapshot(db: Session, *, week_offset: int = 0) -> dict[str, Any]:
    start, end = _week_bounds(week_offset)
    bookings = list(
        db.scalars(
            select(SalonBooking).where(SalonBooking.created_at >= start, SalonBooking.created_at < end)
        )
    )
    total = len(bookings)
    completed = sum(1 for b in bookings if b.lifecycle_status == "completed")
    cancelled = sum(1 for b in bookings if b.lifecycle_status == "cancelled")
    no_show = sum(1 for b in bookings if b.lifecycle_status == "no_show")
    fee_paid = sum(1 for b in bookings if b.fee_paid_paise > 0)
    repeat_users = 0
    user_counts: dict[str, int] = {}
    for b in bookings:
        user_counts[b.user_id] = user_counts.get(b.user_id, 0) + 1
    repeat_users = sum(1 for _u, c in user_counts.items() if c >= 2)

    disputes = int(
        db.scalar(
            select(func.count()).select_from(Dispute).where(
                Dispute.created_at_unix >= start, Dispute.created_at_unix < end
            )
        )
        or 0
    )
    reviews = int(
        db.scalar(
            select(func.count()).select_from(VendorReview).where(
                VendorReview.created_at_unix >= start, VendorReview.created_at_unix < end
            )
        )
        or 0
    )

    conversion_proxy = (fee_paid / total) if total else 0.0
    repeat_rate = (repeat_users / len(user_counts)) if user_counts else 0.0
    no_show_rate = (no_show / total) if total else 0.0
    cancel_rate = (cancelled / total) if total else 0.0
    dispute_rate = (disputes / total) if total else 0.0

    return {
        "window_start_unix": start,
        "window_end_unix": end,
        "bookings_created": total,
        "completed_bookings": completed,
        "cancelled_bookings": cancelled,
        "no_show_bookings": no_show,
        "platform_fee_checkouts_started_proxy": fee_paid,
        "conversion_proxy_fee_paid_over_created": round(conversion_proxy, 4),
        "repeat_user_ratio": round(repeat_rate, 4),
        "no_show_rate": round(no_show_rate, 4),
        "cancellation_rate": round(cancel_rate, 4),
        "dispute_rate": round(dispute_rate, 4),
        "reviews_submitted": reviews,
        "note": "Cost per booking needs finance ingest; this is SQL side operational ratio bundle.",
    }


def check_for_anomalies(db: Session, settings: Settings) -> list[dict[str, Any]]:
    """
    Tracks:
    * refunds per hour
    * failed transfers per hour
    * cancellations per hour
    """
    now = int(time.time())
    hour_ago = now - 3600
    anomalies = []

    # 1. Refunds per hour
    refunds_count = int(
        db.scalar(
            select(func.count()).select_from(RefundLog).where(RefundLog.created_at >= hour_ago)
        )
        or 0
    )
    if refunds_count > settings.anomaly_refund_threshold_per_hour:
        anomalies.append({
            "type": "high_refund_rate",
            "count": refunds_count,
            "threshold": settings.anomaly_refund_threshold_per_hour,
            "message": f"system_anomaly_detected: {refunds_count} refunds in last hour"
        })

    # 2. Failed transfers per hour
    failed_transfers_count = int(
        db.scalar(
            select(func.count()).select_from(Booking).where(
                Booking.status == "TRANSFER_FAILED",
                Booking.created_at >= hour_ago # Assuming created_at is when it happened or close to it
            )
        )
        or 0
    )
    if failed_transfers_count > settings.anomaly_failed_transfer_threshold_per_hour:
        anomalies.append({
            "type": "high_transfer_failure_rate",
            "count": failed_transfers_count,
            "threshold": settings.anomaly_failed_transfer_threshold_per_hour,
            "message": f"system_anomaly_detected: {failed_transfers_count} failed transfers in last hour"
        })

    # 3. Cancellations per hour (SalonBooking)
    cancellations_count = int(
        db.scalar(
            select(func.count()).select_from(SalonBooking).where(
                SalonBooking.lifecycle_status == "cancelled",
                SalonBooking.updated_at >= hour_ago
            )
        )
        or 0
    )
    if cancellations_count > settings.anomaly_cancellation_threshold_per_hour:
        anomalies.append({
            "type": "high_cancellation_rate",
            "count": cancellations_count,
            "threshold": settings.anomaly_cancellation_threshold_per_hour,
            "message": f"system_anomaly_detected: {cancellations_count} cancellations in last hour"
        })

    # 4. Same operator repeated actions (Phase 6)
    operator_actions = db.scalars(
        select(func.count(), Booking.id) # Placeholder for real audit log check
        .group_by(Booking.id)
        .having(func.count() > 3)
    ).all()
    # In a real system, we'd query AdminActionLog
    # For now, we'll implement a simple check for repeated repairs
    repeated_repairs = db.scalars(
        select(Booking).where(Booking.repair_attempted == 1)
    ).all()
    for b in repeated_repairs:
        if b.repair_log and b.repair_log.count("Repair run") > 3:
             anomalies.append({
                "type": "repeated_repair_failure",
                "booking_id": b.id,
                "severity": "CRITICAL",
                "message": f"CRITICAL: Repeated repair attempts failed for booking {b.id}"
            })

    for anomaly in anomalies:
        logger.error(anomaly["message"])

    return anomalies


def send_financial_alert(event_type: str, payload: dict[str, Any]):
    """
    Trigger on:
    * invariant violation
    * transfer failure
    * refund failure
    * reconciliation mismatch
    """
    logger.critical(f"FINANCIAL_ALERT: {event_type} payload={payload}")
    # In a real system, this would send to PagerDuty/Slack/Email
    # For now, we rely on structured logs for external monitoring.
    print(f"!!! FINANCIAL ALERT [{event_type}] !!!: {payload}")
