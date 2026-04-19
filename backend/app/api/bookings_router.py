from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import Settings, get_settings
from app.db.session import get_db
from app.deps import optional_internal_key, require_route_enabled
from app.services import payment_service

router = APIRouter(
    prefix="/api/v1/bookings",
    tags=["bookings"],
    dependencies=[Depends(optional_internal_key)],
)


class CreateBookingCheckoutIn(BaseModel):
    vendor_id: str = Field(..., min_length=1, max_length=36)
    base_price_inr: Decimal = Field(..., gt=Decimal("0"))


@router.post("/checkout", status_code=201)
async def create_booking_checkout(
    body: CreateBookingCheckoutIn,
    settings: Annotated[Settings, Depends(require_route_enabled)],
    db: Session = Depends(get_db),
) -> dict:
    try:
        booking, order = await payment_service.create_route_booking_checkout(
            db,
            settings,
            vendor_id=body.vendor_id,
            base_price_inr=body.base_price_inr,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=str(e)) from e

    return {
        "booking_id": booking.id,
        "vendor_id": booking.vendor_id,
        "base_price_inr": booking.base_price_inr,
        "platform_fee_inr": booking.platform_fee_inr,
        "total_amount_inr": booking.total_amount_inr,
        "vendor_payout_inr": booking.vendor_payout_inr,
        "total_amount_paise": booking.total_amount_paise,
        "razorpay_order_id": booking.razorpay_order_id,
        "razorpay_key_id": settings.razorpay_key_id,
        "currency": "INR",
    }


import time
import uuid
from datetime import datetime
from app.schemas import BookingPreviewIn, BookingPreviewOut, BookingCreateIn, BookingOut, BookingStatusUpdateIn, ReviewCreateIn, ReviewOut
from app.models.marketplace import SalonBooking
from app.models.controlled_marketplace import VendorReview, CustomerRetentionProfile
from app.models.service import Service

@router.post("/preview", response_model=BookingPreviewOut)
async def preview_booking(body: BookingPreviewIn, db: Session = Depends(get_db)):
    service = db.get(Service, body.service_id)
    service_price_paise = service.price_paise if service else 50000

    platform_fee_paise = 2000

    # 1. First Booking Free Logic
    if body.user_id:
        profile = db.get(CustomerRetentionProfile, body.user_id)
        if not profile or profile.loyalty_points == 0:
            platform_fee_paise = 0
            
    # 2. Dynamic Time-based Pricing
    dt = datetime.fromtimestamp(body.slot_start_unix)
    if dt.weekday() >= 5 or 17 <= dt.hour <= 20:
        platform_fee_paise += 1000

    tax_paise = int(platform_fee_paise * 0.18)
    
    return BookingPreviewOut(
        service_price_paise=service_price_paise,
        platform_fee_paise=platform_fee_paise,
        tax_paise=tax_paise,
        total_amount_paise=service_price_paise + platform_fee_paise + tax_paise
    )

@router.post("/create", response_model=BookingOut)
async def create_booking(body: BookingCreateIn, db: Session = Depends(get_db)):
    booking_id = str(uuid.uuid4())
    # Create locking and booking logic here
    # For now, returning mocked structure
    return BookingOut(
        id=booking_id,
        lifecycle_status="created",
        service_price_paise=body.expected_price_paise,
        platform_fee_paise=2000,
        tax_paise=360,
        total_amount_paise=body.expected_price_paise + 2360
    )



@router.post("/{id}/status", response_model=BookingOut)
async def update_booking_status(id: str, body: BookingStatusUpdateIn, db: Session = Depends(get_db)):
    booking = db.get(SalonBooking, id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")

    booking.lifecycle_status = body.lifecycle_status
    booking.updated_at = int(time.time())

    # Anti-bypass: Reward loyalty points on completion
    if body.lifecycle_status == "completed":
        profile = db.get(CustomerRetentionProfile, booking.user_id)
        if not profile:
            profile = CustomerRetentionProfile(
                user_id=booking.user_id,
                updated_at_unix=int(time.time()),
                loyalty_points=0
            )
            db.add(profile)
        
        profile.loyalty_points += 10  # 10 points per completed booking
        profile.updated_at_unix = int(time.time())

    db.commit()

    return BookingOut(
        id=id,
        lifecycle_status=booking.lifecycle_status,
        service_price_paise=booking.service_price_paise,
        platform_fee_paise=booking.platform_fee_paise,
        tax_paise=booking.tax_paise,
        total_amount_paise=booking.total_amount_paise
    )

@router.post("/{id}/review", response_model=ReviewOut)
async def submit_verified_review(id: str, body: ReviewCreateIn, db: Session = Depends(get_db)):
    booking = db.get(SalonBooking, id)
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
        
    if booking.lifecycle_status != "completed":
        raise HTTPException(status_code=403, detail="Reviews can only be submitted for completed bookings")
        
    existing_review = db.query(VendorReview).filter(VendorReview.salon_booking_id == id).first()
    if existing_review:
        raise HTTPException(status_code=409, detail="Review already submitted for this booking")
        
    review = VendorReview(
        id=str(uuid.uuid4()),
        created_at_unix=int(time.time()),
        salon_booking_id=id,
        user_id=booking.user_id,
        vendor_id=booking.vendor_id,
        stars=body.stars,
        body=body.body,
        weight=1.0
    )
    db.add(review)
    db.commit()
    
    return ReviewOut(
        id=review.id,
        stars=review.stars,
        body=review.body,
        is_verified=True
    )

@router.post("/{id}/cancel", response_model=BookingOut)
async def cancel_booking(id: str, db: Session = Depends(get_db)):
    # Use with_for_update() to prevent race condition with webhook payment capture
    booking = db.query(SalonBooking).filter(SalonBooking.id == id).with_for_update().first()
    if not booking:
        raise HTTPException(status_code=404, detail="Booking not found")
        
    if booking.lifecycle_status in ["cancelled", "completed", "no_show"]:
        raise HTTPException(status_code=400, detail="Booking cannot be cancelled in its current state")
        
    booking.lifecycle_status = "cancelled"
    booking.updated_at = int(time.time())
    
    # 2-Hour Cutoff Penalty
    time_until_slot = booking.slot_start_unix - int(time.time())
    if time_until_slot < 7200:
        profile = db.get(CustomerRetentionProfile, booking.user_id)
        if profile:
            profile.loyalty_points = max(0, profile.loyalty_points - 5)
            
    db.commit()
    
    # Trigger waitlist
    from app.worker import process_waitlist
    process_waitlist.delay(booking.id)
    
    return BookingOut(
        id=booking.id,
        lifecycle_status=booking.lifecycle_status,
        service_price_paise=booking.service_price_paise,
        platform_fee_paise=booking.platform_fee_paise,
        tax_paise=booking.tax_paise,
        total_amount_paise=booking.total_amount_paise
    )
