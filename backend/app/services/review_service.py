"""Verified booking reviews only; light fake pattern flags."""
from __future__ import annotations

import hashlib
import json
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.controlled_marketplace import VendorReview
from app.models.marketplace import SalonBooking
from app.models.vendor import Vendor


def _repeat_weight(db: Session, user_id: str, vendor_id: str) -> float:
    q = select(SalonBooking).where(
        SalonBooking.user_id == user_id,
        SalonBooking.vendor_id == vendor_id,
        SalonBooking.lifecycle_status == "completed",
    )
    n = len(list(db.scalars(q)))
    return 1.2 if n >= 3 else 1.0


def _fake_flags(body: str | None, stars: int) -> dict[str, Any]:
    flags: dict[str, Any] = {}
    if body:
        if len(body.strip()) < 8:
            flags["short_text"] = True
        h = hashlib.sha256(body.strip().lower().encode()).hexdigest()
        flags["body_hash"] = h[:16]
    if stars in (1, 5) and (not body or len(body.strip()) < 12):
        flags["extreme_rating_thin_text"] = True
    return flags


def submit_review(
    db: Session,
    *,
    salon_booking_id: str,
    user_id: str,
    stars: int,
    body: str | None = None,
) -> VendorReview:
    if stars < 1 or stars > 5:
        raise ValueError("stars invalid")
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.user_id != user_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status != "completed":
        raise ValueError("only completed bookings can review")
    existing = db.scalar(select(VendorReview).where(VendorReview.salon_booking_id == salon_booking_id))
    if existing:
        raise ValueError("already reviewed")
    weight = _repeat_weight(db, user_id, sb.vendor_id)
    flags = _fake_flags(body, stars)
    vr = VendorReview(
        id=str(uuid.uuid4()),
        created_at_unix=int(time.time()),
        salon_booking_id=salon_booking_id,
        user_id=user_id,
        vendor_id=sb.vendor_id,
        stars=stars,
        body=body,
        weight=weight,
        flags_json=json.dumps(flags),
    )
    db.add(vr)
    v = db.get(Vendor, sb.vendor_id)
    if v:
        # Exponential moving average toward new stars
        prev = float(v.rating or 4.5)
        v.rating = round((prev * 0.85) + (stars * 0.15), 3)
        db.add(v)
    db.commit()
    db.refresh(vr)
    return vr
