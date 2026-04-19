"""Admin analytics and operational rollups (MVP aggregates for India marketplace)."""
from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.booking import Booking
from app.models.marketplace import SalonBooking, SlotHistory, WaitlistEntry
from app.models.vendor import Vendor


def dashboard_summary(db: Session) -> dict:
    salon_total = int(db.scalar(select(func.count()).select_from(SalonBooking)) or 0)
    salon_confirmed = int(
        db.scalar(
            select(func.count())
            .select_from(SalonBooking)
            .where(SalonBooking.lifecycle_status == "confirmed")
        )
        or 0
    )
    salon_no_show = int(
        db.scalar(
            select(func.count())
            .select_from(SalonBooking)
            .where(SalonBooking.lifecycle_status == "no_show")
        )
        or 0
    )
    salon_fee_paid = int(
        db.scalar(
            select(func.count())
            .select_from(SalonBooking)
            .where(SalonBooking.payment_status == "platform_fee_paid")
        )
        or 0
    )
    route_paid = int(
        db.scalar(select(func.count()).select_from(Booking).where(Booking.status == "paid")) or 0
    )
    vendors = int(db.scalar(select(func.count()).select_from(Vendor)) or 0)
    waitlist_open = int(
        db.scalar(
            select(func.count())
            .select_from(WaitlistEntry)
            .where(WaitlistEntry.status == "waiting")
        )
        or 0
    )
    slot_events = int(db.scalar(select(func.count()).select_from(SlotHistory)) or 0)

    conversion = (salon_fee_paid / salon_total) if salon_total else 0.0
    no_show_rate = (salon_no_show / salon_confirmed) if salon_confirmed else 0.0

    return {
        "salon_bookings_total": salon_total,
        "salon_bookings_confirmed": salon_confirmed,
        "salon_bookings_no_show": salon_no_show,
        "salon_platform_fee_paid_count": salon_fee_paid,
        "route_payment_bookings_paid": route_paid,
        "vendors_total": vendors,
        "waitlist_waiting": waitlist_open,
        "slot_history_events": slot_events,
        "estimated_fee_acceptance_rate": round(conversion, 4),
        "estimated_no_show_rate_on_confirmed": round(no_show_rate, 4),
        "notes": "Economics: subtract Razorpay fees, refunds, support load in BI layer.",
    }


def trust_leaderboard(db: Session, *, limit: int = 20) -> list[dict]:
    rows = list(
        db.scalars(
            select(Vendor)
            .where(Vendor.verification_status == "approved")
            .order_by(Vendor.rating.desc(), Vendor.completion_rate.desc())
            .limit(limit)
        )
    )
    out = []
    for v in rows:
        badges = v.badges_json or "{}"
        out.append(
            {
                "vendor_id": v.id,
                "name": v.name,
                "rating": v.rating,
                "completion_rate": v.completion_rate,
                "punctuality_score": v.punctuality_score,
                "cancellation_rate": v.cancellation_rate,
                "no_show_rate": v.no_show_rate,
                "penalty_rank_score": v.penalty_rank_score,
                "badges_json": badges,
            }
        )
    return out
