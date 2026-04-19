from __future__ import annotations

from decimal import Decimal
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.config import Settings
from app.db.session import get_db
from app.deps import optional_internal_key, require_route_enabled
from app.money import rupees_to_paise
from app.services import (
    booking_service,
    discovery_service,
    dispute_service,
    fee_policy_service,
    onboarding_service,
    retention_service,
    review_service,
    slot_engine,
    supply_quality_service,
    vendor_service,
)

router = APIRouter(
    prefix="/api/v1/marketplace",
    tags=["marketplace"],
    dependencies=[Depends(optional_internal_key)],
)


class FeePreviewBody(BaseModel):
    vendor_id: str = Field(..., min_length=1)
    user_id: str = Field(..., min_length=1)
    service_price_inr: Decimal = Field(..., gt=Decimal("0"))
    slot_start_unix: int = Field(..., gt=0)
    slot_end_unix: int = Field(..., gt=0)
    risky_slot: bool = False


@router.post("/fee-preview")
def marketplace_fee_preview(
    body: FeePreviewBody,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    sp = rupees_to_paise(body.service_price_inr)
    prev = fee_policy_service.preview_platform_fee(
        settings,
        db,
        user_id=body.user_id,
        service_price_paise=sp,
        slot_start_unix=body.slot_start_unix,
        risky_slot=body.risky_slot,
    )
    return {
        "service_price_paise": prev.service_price_paise,
        "platform_fee_paise": prev.platform_fee_paise,
        "total_online_paise_phase1": prev.total_online_paise_phase1,
        "is_first_booking_free": prev.is_first_booking_free,
        "is_peak": prev.is_peak,
        "suggested_deposit_paise": prev.suggested_deposit_paise,
        "breakdown": prev.breakdown,
        "fee_explanation": prev.fee_explanation,
        "value_proposition_line": prev.value_proposition_line,
    }


class SlotHoldBody(BaseModel):
    vendor_id: str
    barber_id: str | None = None
    slot_start_unix: int
    slot_end_unix: int
    user_id: str


@router.post("/slot-hold", status_code=201)
def create_slot_hold(
    body: SlotHoldBody,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    try:
        h = slot_engine.acquire_hold(
            db,
            settings,
            vendor_id=body.vendor_id,
            barber_id=body.barber_id,
            slot_start_unix=body.slot_start_unix,
            slot_end_unix=body.slot_end_unix,
            user_id=body.user_id,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e)) from e
    except IntegrityError:
        db.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Slot already taken")
    return {
        "hold_token": h.hold_token,
        "expires_at_unix": h.expires_at_unix,
        "vendor_id": h.vendor_id,
        "barber_id": h.barber_id,
    }


class SalonBookingBody(BaseModel):
    hold_token: str
    user_id: str
    customer_phone: str = Field(..., min_length=8)
    service_price_inr: Decimal = Field(..., gt=Decimal("0"))
    risky_slot: bool = False
    source: Literal["app", "walk_in"] = "app"


@router.post("/salon-bookings", status_code=201)
def create_salon_booking(
    body: SalonBookingBody,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    sp = rupees_to_paise(body.service_price_inr)
    try:
        sb = booking_service.create_salon_booking_from_hold(
            db,
            settings,
            hold_token=body.hold_token,
            user_id=body.user_id,
            customer_phone=body.customer_phone,
            service_price_paise=sp,
            risky_slot=body.risky_slot,
            source=body.source,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {
        "salon_booking_id": sb.id,
        "lifecycle_status": sb.lifecycle_status,
        "payment_status": sb.payment_status,
        "platform_fee_paise": sb.platform_fee_paise,
        "service_price_paise": sb.service_price_paise,
        "customer_phone_masked": sb.customer_phone_masked,
    }


@router.post("/salon-bookings/{salon_booking_id}/phase1-checkout")
async def salon_phase1_checkout(
    salon_booking_id: str,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    try:
        return await booking_service.start_phase1_online_payment(db, settings, salon_booking_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


class BarberDecisionBody(BaseModel):
    vendor_id: str
    accept: bool


@router.post("/salon-bookings/{salon_booking_id}/barber-decision")
def barber_decision(
    salon_booking_id: str,
    body: BarberDecisionBody,
    db: Session = Depends(get_db),
) -> dict:
    try:
        sb = booking_service.barber_accept_reject(
            db, salon_booking_id=salon_booking_id, vendor_id=body.vendor_id, accept=body.accept
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"salon_booking_id": sb.id, "lifecycle_status": sb.lifecycle_status}


class WaitlistBody(BaseModel):
    vendor_id: str
    user_id: str
    slot_start_unix: int
    slot_end_unix: int


@router.post("/waitlist", status_code=201)
def waitlist_join(
    body: WaitlistBody,
    db: Session = Depends(get_db),
) -> dict:
    w = booking_service.join_waitlist(
        db,
        vendor_id=body.vendor_id,
        user_id=body.user_id,
        slot_start_unix=body.slot_start_unix,
        slot_end_unix=body.slot_end_unix,
    )
    return {"waitlist_id": w.id, "status": w.status}


class AvailabilityBody(BaseModel):
    vendor_id: str
    payload: dict


@router.post("/vendor/availability")
def post_availability(
    body: AvailabilityBody,
    db: Session = Depends(get_db),
) -> dict:
    try:
        v = vendor_service.update_vendor_availability(db, body.vendor_id, body.payload)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"vendor_id": v.id, "availability_json": v.availability_json}


class VendorShopProfileBody(BaseModel):
    vendor_id: str
    address_line: str | None = None
    hours_json: str | None = None
    photo_urls_json: str | None = None
    city_code: str | None = None


@router.post("/vendor/shop-profile")
def post_vendor_shop_profile(body: VendorShopProfileBody, db: Session = Depends(get_db)) -> dict:
    try:
        v = vendor_service.update_vendor_shop_profile(
            db,
            body.vendor_id,
            address_line=body.address_line,
            hours_json=body.hours_json,
            photo_urls_json=body.photo_urls_json,
            city_code=body.city_code,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    supply_quality_service.mark_vendor_active(db, body.vendor_id)
    ok, reason = supply_quality_service.is_vendor_listable(v)
    return {"vendor_id": v.id, "listable": ok, "listable_reason": reason}


@router.get("/retention/rebook-suggestion")
def get_rebook_suggestion(user_id: str, db: Session = Depends(get_db)) -> dict:
    return retention_service.rebook_suggestion(db, user_id=user_id)


class RetentionPreferencesBody(BaseModel):
    user_id: str
    preferences: dict


@router.post("/retention/preferences")
def post_retention_preferences(body: RetentionPreferencesBody, db: Session = Depends(get_db)) -> dict:
    prof = retention_service.update_preferences(db, user_id=body.user_id, preferences=body.preferences)
    return {"user_id": prof.user_id, "preferences_json": prof.preferences_json}


class SalonCancelBody(BaseModel):
    user_id: str


@router.post("/salon-bookings/{salon_booking_id}/cancel-customer")
def cancel_salon_booking_customer_route(
    salon_booking_id: str,
    body: SalonCancelBody,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    try:
        sb = booking_service.cancel_salon_booking_customer(
            db, settings, salon_booking_id=salon_booking_id, user_id=body.user_id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"salon_booking_id": sb.id, "lifecycle_status": sb.lifecycle_status}


class SalonUserBody(BaseModel):
    user_id: str


@router.post("/salon-bookings/{salon_booking_id}/customer-confirm")
def customer_confirm_route(salon_booking_id: str, body: SalonUserBody, db: Session = Depends(get_db)) -> dict:
    try:
        sb = booking_service.customer_confirm_arrival(
            db, salon_booking_id=salon_booking_id, user_id=body.user_id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {
        "salon_booking_id": sb.id,
        "customer_arrival_confirmed_at_unix": sb.customer_arrival_confirmed_at_unix,
    }


class SalonVendorBody(BaseModel):
    vendor_id: str


@router.post("/salon-bookings/{salon_booking_id}/complete")
def complete_salon_route(
    salon_booking_id: str,
    body: SalonVendorBody,
    settings: Settings = Depends(require_route_enabled),
    db: Session = Depends(get_db),
) -> dict:
    try:
        sb = booking_service.complete_salon_booking(
            db, settings, salon_booking_id=salon_booking_id, vendor_id=body.vendor_id
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"salon_booking_id": sb.id, "lifecycle_status": sb.lifecycle_status}


class BarberFaultBody(BaseModel):
    vendor_id: str
    summary: str | None = None


@router.post("/salon-bookings/{salon_booking_id}/barber-fault-cancel")
def barber_fault_cancel_route(
    salon_booking_id: str, body: BarberFaultBody, db: Session = Depends(get_db)
) -> dict:
    try:
        sb, d = booking_service.barber_fault_cancel_with_dispute(
            db,
            salon_booking_id=salon_booking_id,
            vendor_id=body.vendor_id,
            summary=body.summary,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"salon_booking_id": sb.id, "lifecycle_status": sb.lifecycle_status, "dispute_id": d.id}


class ReviewBodyFull(BaseModel):
    salon_booking_id: str
    user_id: str
    stars: int = Field(..., ge=1, le=5)
    body: str | None = None


@router.post("/reviews/submit", status_code=201)
def submit_review_route_full(body: ReviewBodyFull, db: Session = Depends(get_db)) -> dict:
    try:
        vr = review_service.submit_review(
            db,
            salon_booking_id=body.salon_booking_id,
            user_id=body.user_id,
            stars=body.stars,
            body=body.body,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"review_id": vr.id, "weight": vr.weight, "flags_json": vr.flags_json}


@router.get("/discovery/rank")
def discovery_rank(city_code: str, db: Session = Depends(get_db), limit: int = 30) -> list[dict]:
    return discovery_service.rank_vendors_for_city(db, city_code=city_code, limit=limit)


class OnboardingChecklistBody(BaseModel):
    vendor_id: str
    checklist: dict[str, bool]


@router.post("/vendor/onboarding/checklist")
def vendor_onboarding_checklist(body: OnboardingChecklistBody, db: Session = Depends(get_db)) -> dict:
    return onboarding_service.update_checklist(db, body.vendor_id, body.checklist)


class VendorIdOnlyBody(BaseModel):
    vendor_id: str


@router.post("/vendor/onboarding/mark-bookable")
def vendor_mark_bookable(body: VendorIdOnlyBody, db: Session = Depends(get_db)) -> dict:
    try:
        return onboarding_service.try_mark_bookable(db, body.vendor_id)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e


class DisputeOpenBody(BaseModel):
    salon_booking_id: str
    opened_by: str = Field(..., min_length=1, max_length=24)
    summary: str | None = None


@router.post("/disputes/open", status_code=201)
def open_dispute_route(body: DisputeOpenBody, db: Session = Depends(get_db)) -> dict:
    try:
        d = dispute_service.open_dispute(
            db,
            salon_booking_id=body.salon_booking_id,
            opened_by=body.opened_by,
            summary=body.summary,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    return {"dispute_id": d.id, "status": d.status}


@router.get("/vendor/listable-check")
def vendor_listable_check(vendor_id: str, db: Session = Depends(get_db)) -> dict:
    v = vendor_service.get_vendor(db, vendor_id)
    if not v:
        raise HTTPException(status_code=404, detail="vendor not found")
    ok, reason = supply_quality_service.is_vendor_listable(v)
    return {"vendor_id": vendor_id, "listable": ok, "reason": reason}
