"""Verified shop gates, hide inactive, listability for discovery."""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session

from app.models.vendor import Vendor


def vendor_profile_complete(v: Vendor) -> bool:
    if not (v.address_line and v.hours_json and v.photo_urls_json):
        return False
    try:
        photos = json.loads(v.photo_urls_json)
        if not isinstance(photos, list) or len(photos) < 1:
            return False
    except json.JSONDecodeError:
        return False
    return True


def is_vendor_listable(v: Vendor, *, now_unix: int | None = None) -> tuple[bool, str | None]:
    now = now_unix or int(time.time())
    if v.listing_hidden_reason:
        return False, v.listing_hidden_reason
    if v.verification_status != "approved":
        return False, "not_verified"
    if not v.is_bookable:
        return False, "not_bookable"
    if not vendor_profile_complete(v):
        return False, "profile_incomplete"
    if v.last_active_unix and now - v.last_active_unix > 14 * 86400:
        return False, "inactive_14d"
    return True, None


def mark_vendor_active(db: Session, vendor_id: str) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise ValueError("vendor not found")
    v.last_active_unix = int(time.time())
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def set_listing_hidden(db: Session, vendor_id: str, reason: str | None) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise ValueError("vendor not found")
    v.listing_hidden_reason = reason
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def apply_periodic_quality_pass(db: Session, *, now_unix: int | None = None) -> dict[str, Any]:
    """Admin cron: hide unresponsive vendors with no heartbeat."""
    from sqlalchemy import select

    now = now_unix or int(time.time())
    hidden = 0
    for v in db.scalars(select(Vendor)):
        ok, reason = is_vendor_listable(v, now_unix=now)
        if not ok and reason == "inactive_14d":
            v.listing_hidden_reason = "inactive_14d"
            db.add(v)
            hidden += 1
    db.commit()
    return {"vendors_hidden_inactive": hidden}
