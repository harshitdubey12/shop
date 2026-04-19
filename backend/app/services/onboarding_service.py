"""Five minute assisted onboarding checklist and bookable gate."""
from __future__ import annotations

import json
import time
from typing import Any

from sqlalchemy.orm import Session

from app.models.controlled_marketplace import VendorOnboardingState
from app.models.vendor import Vendor

from app.services.supply_quality_service import vendor_profile_complete


DEFAULT_CHECKLIST: dict[str, bool] = {
    "shop_name": False,
    "services": False,
    "pricing": False,
    "hours": False,
    "photos": False,
}


def get_or_create_onboarding(db: Session, vendor_id: str) -> VendorOnboardingState:
    now = int(time.time())
    row = db.get(VendorOnboardingState, vendor_id)
    if row:
        return row
    row = VendorOnboardingState(
        vendor_id=vendor_id,
        created_at_unix=now,
        updated_at_unix=now,
        checklist_json=json.dumps(DEFAULT_CHECKLIST),
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return row


def update_checklist(db: Session, vendor_id: str, checklist: dict[str, bool]) -> dict[str, Any]:
    row = get_or_create_onboarding(db, vendor_id)
    merged = {**DEFAULT_CHECKLIST, **checklist}
    row.checklist_json = json.dumps(merged)
    row.updated_at_unix = int(time.time())
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"checklist": merged, "bookable_confirmed_at_unix": row.bookable_confirmed_at_unix}


def try_mark_bookable(db: Session, vendor_id: str) -> dict[str, Any]:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise ValueError("vendor not found")
    row = get_or_create_onboarding(db, vendor_id)
    checklist = json.loads(row.checklist_json or "{}")
    ok = (
        checklist.get("shop_name")
        and checklist.get("services")
        and checklist.get("pricing")
        and checklist.get("hours")
        and checklist.get("photos")
        and vendor_profile_complete(v)
        and v.verification_status == "approved"
    )
    msg = "complete checklist and verification"
    if ok:
        v.is_bookable = True
        now = int(time.time())
        if not row.bookable_confirmed_at_unix:
            row.bookable_confirmed_at_unix = now
        row.updated_at_unix = now
        db.add(v)
        db.add(row)
        db.commit()
        msg = "You are now bookable on the marketplace"
    return {"is_bookable": v.is_bookable, "message": msg, "checklist": checklist}
