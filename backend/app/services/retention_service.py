"""One tap rebooking data, loyalty, wallet credits locked to platform spend."""
from __future__ import annotations

import json
import time
import uuid
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.controlled_marketplace import CustomerRetentionProfile
from app.models.marketplace import SalonBooking


def get_or_create_profile(db: Session, user_id: str) -> CustomerRetentionProfile:
    now = int(time.time())
    row = db.get(CustomerRetentionProfile, user_id)
    if row:
        return row
    row = CustomerRetentionProfile(
        user_id=user_id,
        updated_at_unix=now,
        loyalty_points=0,
        wallet_paise=0,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def snapshot_from_booking(sb: SalonBooking) -> dict[str, Any]:
    return {
        "vendor_id": sb.vendor_id,
        "barber_id": sb.barber_id,
        "slot_start_unix": sb.slot_start_unix,
        "slot_end_unix": sb.slot_end_unix,
        "service_price_paise": sb.service_price_paise,
    }


def on_booking_completed(
    db: Session,
    settings: Settings,
    *,
    user_id: str,
    booking: SalonBooking,
) -> CustomerRetentionProfile:
    prof = get_or_create_profile(db, user_id)
    prof.favorite_vendor_id = booking.vendor_id
    prof.last_booking_snapshot_json = json.dumps(snapshot_from_booking(booking))
    prof.loyalty_points += settings.loyalty_points_per_completed_booking
    if settings.wallet_credit_per_100_points_paise > 0 and prof.loyalty_points >= 100:
        blocks = prof.loyalty_points // 100
        credit = blocks * settings.wallet_credit_per_100_points_paise
        prof.wallet_paise += credit
        prof.loyalty_points -= blocks * 100
    prof.updated_at_unix = int(time.time())
    db.add(prof)
    db.commit()
    db.refresh(prof)
    return prof


def rebook_suggestion(db: Session, *, user_id: str) -> dict[str, Any]:
    prof = db.get(CustomerRetentionProfile, user_id)
    last = None
    if prof and prof.last_booking_snapshot_json:
        try:
            last = json.loads(prof.last_booking_snapshot_json)
        except json.JSONDecodeError:
            last = None
    history = list(
        db.scalars(
            select(SalonBooking)
            .where(SalonBooking.user_id == user_id)
            .order_by(SalonBooking.created_at.desc())
            .limit(20)
        )
    )
    return {
        "favorite_vendor_id": prof.favorite_vendor_id if prof else None,
        "last_slot": last,
        "loyalty_points": prof.loyalty_points if prof else 0,
        "wallet_paise": prof.wallet_paise if prof else 0,
        "preferences_json": prof.preferences_json if prof else None,
        "recent_booking_ids": [b.id for b in history],
    }


def update_preferences(db: Session, *, user_id: str, preferences: dict[str, Any]) -> CustomerRetentionProfile:
    prof = get_or_create_profile(db, user_id)
    prof.preferences_json = json.dumps(preferences)
    prof.updated_at_unix = int(time.time())
    db.add(prof)
    db.commit()
    db.refresh(prof)
    return prof


def record_abuse_same_phone_many_vendors(db: Session, *, phone_hash: str, vendor_count_threshold: int = 4) -> None:
    """Heuristic: same phone hash hits many vendors same day could be bypass farming."""
    from app.models.controlled_marketplace import AbuseSignal

    day_start = int(time.time()) // 86400 * 86400
    q = (
        select(func.count(func.distinct(SalonBooking.vendor_id)))
        .select_from(SalonBooking)
        .where(
            SalonBooking.customer_phone_hash == phone_hash,
            SalonBooking.created_at >= day_start,
        )
    )
    n = int(db.scalar(q) or 0)
    if n >= vendor_count_threshold:
        db.add(
            AbuseSignal(
                id=str(uuid.uuid4()),
                created_at_unix=int(time.time()),
                signal_type="phone_many_vendors_day",
                user_id=None,
                vendor_id=None,
                salon_booking_id=None,
                meta_json=json.dumps({"phone_hash_prefix": phone_hash[:16], "distinct_vendors": n}),
            )
        )
        db.commit()
