from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.vendor import Vendor
from app.services import razorpay_service

logger = logging.getLogger(__name__)


def register_vendor(
    db: Session,
    *,
    name: str,
    phone: str,
    email: str,
    bank_account_number: str | None,
    ifsc_code: str | None,
) -> Vendor:
    v = Vendor(
        id=str(uuid.uuid4()),
        created_at=int(time.time()),
        name=name.strip(),
        phone=phone.strip(),
        email=email.strip().lower(),
        bank_account_number=bank_account_number.strip() if bank_account_number else None,
        ifsc_code=ifsc_code.strip().upper() if ifsc_code else None,
        verification_status="pending",
    )
    db.add(v)
    db.commit()
    db.refresh(v)
    return v


def list_vendors(db: Session) -> list[Vendor]:
    return list(db.scalars(select(Vendor).order_by(Vendor.created_at.desc())))


def get_vendor(db: Session, vendor_id: str) -> Vendor | None:
    return db.get(Vendor, vendor_id)


async def approve_vendor_route_account(
    db: Session,
    settings: Settings,
    vendor_id: str,
    *,
    profile: dict[str, Any] | None,
    legal_info: dict[str, Any] | None,
    contact_name: str | None,
    business_type: str = "individual",
) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise ValueError("vendor not found")
    if vendor.verification_status == "rejected":
        raise ValueError("vendor was rejected")
    if vendor.razorpay_account_id:
        raise ValueError("vendor already has a linked account")

    prof = profile or razorpay_service.load_json_setting(
        settings.default_route_account_profile_json, "DEFAULT_ROUTE_ACCOUNT_PROFILE_JSON"
    )
    legal = legal_info or razorpay_service.load_json_setting(
        settings.default_route_account_legal_json, "DEFAULT_ROUTE_ACCOUNT_LEGAL_JSON"
    )
    if not prof or not legal:
        raise ValueError(
            "Missing Route onboarding payload: pass profile and legal_info in the request body "
            "or set DEFAULT_ROUTE_ACCOUNT_PROFILE_JSON and DEFAULT_ROUTE_ACCOUNT_LEGAL_JSON in the environment."
        )

    payload = razorpay_service.build_minimal_route_account_payload(
        email=vendor.email,
        phone=vendor.phone,
        legal_business_name=vendor.name,
        business_type=business_type,
        reference_id=vendor.id,
        profile=prof,
        legal_info=legal,
        contact_name=contact_name or vendor.name,
    )

    try:
        raw = await razorpay_service.create_vendor_razorpay_account(settings, payload)
    except razorpay_service.RazorpayAPIError:
        logger.exception("Razorpay linked account creation failed for vendor %s", vendor_id)
        raise

    acc_id = raw.get("id")
    if not isinstance(acc_id, str) or not acc_id.startswith("acc_"):
        raise RuntimeError("Unexpected Razorpay account response (missing id)")

    vendor.razorpay_account_id = acc_id
    vendor.verification_status = "approved"
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


def reject_vendor(db: Session, vendor_id: str) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise ValueError("vendor not found")
    vendor.verification_status = "rejected"
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


def update_vendor_availability(db: Session, vendor_id: str, availability: dict[str, Any]) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise ValueError("vendor not found")
    vendor.availability_json = json.dumps(availability)
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


def update_vendor_shop_profile(
    db: Session,
    vendor_id: str,
    *,
    address_line: str | None = None,
    hours_json: str | None = None,
    photo_urls_json: str | None = None,
    city_code: str | None = None,
) -> Vendor:
    vendor = db.get(Vendor, vendor_id)
    if not vendor:
        raise ValueError("vendor not found")
    if address_line is not None:
        vendor.address_line = address_line
    if hours_json is not None:
        vendor.hours_json = hours_json
    if photo_urls_json is not None:
        vendor.photo_urls_json = photo_urls_json
    if city_code is not None:
        vendor.city_code = city_code
    vendor.last_active_unix = int(time.time())
    db.add(vendor)
    db.commit()
    db.refresh(vendor)
    return vendor


def recompute_vendor_badges(vendor: Vendor) -> Vendor:
    badges: dict[str, bool] = {}
    if vendor.rating >= 4.5 and vendor.completion_rate >= 0.85:
        badges["trusted_barber"] = True
    if vendor.punctuality_score >= 4.5:
        badges["on_time_barber"] = True
    vendor.badges_json = json.dumps(badges)
    return vendor
