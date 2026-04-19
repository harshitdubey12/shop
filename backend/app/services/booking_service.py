"""Marketplace salon booking orchestration: holds, fees, lifecycle, anti-bypass hooks."""
from __future__ import annotations

import hashlib
import logging
import time
import uuid
from typing import Any

from sqlalchemy.orm import Session

from app.config import Settings
from app.models.controlled_marketplace import Dispute
from app.models.marketplace import SalonBooking, WaitlistEntry
from app.models.vendor import Vendor
from app.services import fee_policy_service, reminder_service, retention_service, slot_engine
from app.services import dispute_service as dispute_svc
from app.services import payment_service as pay_svc

logger = logging.getLogger(__name__)


def _norm_phone_digits(phone: str) -> str:
    return "".join(c for c in phone if c.isdigit())


def hash_customer_phone(phone: str) -> str:
    return hashlib.sha256(_norm_phone_digits(phone).encode()).hexdigest()


def mask_customer_phone(phone: str) -> str:
    d = _norm_phone_digits(phone)
    if len(d) >= 4:
        return "******" + d[-4:]
    return "******"


def create_salon_booking_from_hold(
    db: Session,
    settings: Settings,
    *,
    hold_token: str,
    user_id: str,
    customer_phone: str,
    service_price_paise: int,
    risky_slot: bool = False,
    source: str = "app",
) -> SalonBooking:
    now = int(time.time())
    hold = slot_engine.get_active_hold(db, hold_token, now=now)
    if not hold or hold.user_id != user_id:
        raise ValueError("invalid or expired hold")

    if slot_engine.blocking_confirmed_booking_exists(
        db, vendor_id=hold.vendor_id, slot_start=hold.slot_start_unix, slot_end=hold.slot_end_unix
    ):
        raise ValueError("slot no longer available")

    preview = fee_policy_service.preview_platform_fee(
        settings,
        db,
        user_id=user_id,
        service_price_paise=service_price_paise,
        slot_start_unix=hold.slot_start_unix,
        risky_slot=risky_slot,
    )

    lifecycle = "confirmed" if settings.auto_confirm_salon_booking else "pending_barber"

    sb = SalonBooking(
        id=str(uuid.uuid4()),
        created_at=now,
        updated_at=now,
        user_id=user_id,
        vendor_id=hold.vendor_id,
        barber_id=hold.barber_id,
        slot_start_unix=hold.slot_start_unix,
        slot_end_unix=hold.slot_end_unix,
        lifecycle_status=lifecycle,
        payment_phase=1,
        payment_status="awaiting_platform_fee",
        service_price_paise=preview.service_price_paise,
        platform_fee_paise=preview.platform_fee_paise,
        fee_paid_paise=0,
        source=source,
        customer_phone_masked=mask_customer_phone(customer_phone),
        customer_phone_hash=hash_customer_phone(customer_phone),
        slot_hold_id=hold.id,
        barber_decision="accepted" if lifecycle == "confirmed" else "pending",
    )
    slot_engine.consume_hold(db, hold)
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=hold.vendor_id,
        barber_id=hold.barber_id,
        slot_start=hold.slot_start_unix,
        slot_end=hold.slot_end_unix,
        event="booking_created",
        entity_id=sb.id,
        meta={"user_id": user_id, "lifecycle": lifecycle},
    )
    db.commit()
    db.refresh(sb)
    reminder_service.schedule_default_reminders(db, sb)
    if sb.customer_phone_hash:
        retention_service.record_abuse_same_phone_many_vendors(db, phone_hash=sb.customer_phone_hash)
    return sb


async def start_phase1_online_payment(
    db: Session,
    settings: Settings,
    salon_booking_id: str,
) -> dict[str, Any]:
    """Creates Razorpay order for platform fee only (Phase 1). Service paid at shop."""
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb:
        raise ValueError("booking not found")
    if sb.platform_fee_paise <= 0:
        sb.payment_status = "platform_fee_paid"
        sb.updated_at = int(time.time())
        db.add(sb)
        db.commit()
        return {"skipped_payment": True, "reason": "zero platform fee"}
    return await pay_svc.create_phase1_platform_fee_checkout(db, settings, salon_booking=sb)


def cancel_salon_booking_customer(
    db: Session,
    settings: Settings,
    *,
    salon_booking_id: str,
    user_id: str,
    now_unix: int | None = None,
) -> SalonBooking:
    """Respects cancel cutoff before slot; frees slot and offers waitlist."""
    now = now_unix or int(time.time())
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.user_id != user_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status in ("cancelled", "completed", "no_show"):
        raise ValueError("terminal state")
    seconds_until = sb.slot_start_unix - now
    if settings.cancel_cutoff_seconds > 0 and seconds_until < settings.cancel_cutoff_seconds:
        raise ValueError("late cancel inside cutoff; contact support or barber")
    sb.lifecycle_status = "cancelled"
    sb.updated_at = now
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="customer_cancel",
        entity_id=sb.id,
    )
    db.commit()
    offer_waitlist_on_slot_freed(db, vendor_id=sb.vendor_id, slot_start=sb.slot_start_unix, slot_end=sb.slot_end_unix)
    db.refresh(sb)
    return sb


def mark_no_show(db: Session, *, salon_booking_id: str, actor_vendor_id: str) -> SalonBooking:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.vendor_id != actor_vendor_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status != "confirmed":
        raise ValueError("invalid state")
    sb.lifecycle_status = "no_show"
    sb.updated_at = int(time.time())
    sb.payment_status = "platform_fee_paid"  # fee non-refundable policy (MVP note in meta)
    db.add(sb)
    _bump_vendor_no_show(db, sb.vendor_id)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="no_show",
        entity_id=sb.id,
    )
    db.commit()
    db.refresh(sb)
    return sb


def barber_cancel_penalty(db: Session, *, salon_booking_id: str, vendor_id: str) -> SalonBooking:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.vendor_id != vendor_id:
        raise ValueError("booking not found")
    sb.lifecycle_status = "cancelled"
    sb.updated_at = int(time.time())
    v = db.get(Vendor, vendor_id)
    if v:
        v.penalty_rank_score = (v.penalty_rank_score or 0) + 1
        v.cancellation_rate = min(1.0, (v.cancellation_rate or 0) + 0.05)
        db.add(v)
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="barber_cancel",
        entity_id=sb.id,
    )
    db.commit()
    offer_waitlist_on_slot_freed(db, vendor_id=sb.vendor_id, slot_start=sb.slot_start_unix, slot_end=sb.slot_end_unix)
    db.refresh(sb)
    return sb


def offer_waitlist_on_slot_freed(
    db: Session, *, vendor_id: str, slot_start: int, slot_end: int
) -> list[str]:
    """First matching waitlist row moves to offered; caller notifies user out of band."""
    from sqlalchemy import select

    w = db.scalar(
        select(WaitlistEntry)
        .where(
            WaitlistEntry.vendor_id == vendor_id,
            WaitlistEntry.status == "waiting",
            WaitlistEntry.slot_start_unix == slot_start,
            WaitlistEntry.slot_end_unix == slot_end,
        )
        .order_by(WaitlistEntry.created_at.asc())
        .limit(1)
    )
    if not w:
        return []
    w.status = "offered"
    db.add(w)
    slot_engine.record_slot_history(
        db,
        vendor_id=vendor_id,
        barber_id=None,
        slot_start=slot_start,
        slot_end=slot_end,
        event="waitlist_offered",
        entity_id=w.id,
        meta={"user_id": w.user_id},
    )
    db.commit()
    return [w.user_id]


def complete_salon_booking(db: Session, settings: Settings, *, salon_booking_id: str, vendor_id: str) -> SalonBooking:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.vendor_id != vendor_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status != "confirmed":
        raise ValueError("invalid state")
    now = int(time.time())
    sb.lifecycle_status = "completed"
    sb.updated_at = now
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="completed",
        entity_id=sb.id,
    )
    db.commit()
    retention_service.on_booking_completed(db, settings, user_id=sb.user_id, booking=sb)
    db.refresh(sb)
    return sb


def customer_confirm_arrival(db: Session, *, salon_booking_id: str, user_id: str) -> SalonBooking:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.user_id != user_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status != "confirmed":
        raise ValueError("invalid state")
    sb.customer_arrival_confirmed_at_unix = int(time.time())
    sb.updated_at = sb.customer_arrival_confirmed_at_unix
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="customer_arrival_confirmed",
        entity_id=sb.id,
    )
    db.commit()
    db.refresh(sb)
    return sb


def barber_fault_cancel_with_dispute(
    db: Session, *, salon_booking_id: str, vendor_id: str, summary: str | None = None
) -> tuple[SalonBooking, Dispute]:
    return dispute_svc.open_barber_fault_auto(
        db, salon_booking_id=salon_booking_id, vendor_id=vendor_id, summary=summary
    )


def barber_accept_reject(
    db: Session,
    *,
    salon_booking_id: str,
    vendor_id: str,
    accept: bool,
) -> SalonBooking:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.vendor_id != vendor_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status != "pending_barber":
        raise ValueError("not awaiting barber")
    if accept:
        sb.lifecycle_status = "confirmed"
        sb.barber_decision = "accepted"
    else:
        sb.lifecycle_status = "cancelled"
        sb.barber_decision = "rejected"
    sb.updated_at = int(time.time())
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="barber_accept" if accept else "barber_reject",
        entity_id=sb.id,
    )
    db.commit()
    db.refresh(sb)
    return sb


def join_waitlist(
    db: Session,
    *,
    vendor_id: str,
    user_id: str,
    slot_start_unix: int,
    slot_end_unix: int,
) -> WaitlistEntry:
    w = WaitlistEntry(
        id=str(uuid.uuid4()),
        created_at=int(time.time()),
        vendor_id=vendor_id,
        user_id=user_id,
        slot_start_unix=slot_start_unix,
        slot_end_unix=slot_end_unix,
        status="waiting",
    )
    db.add(w)
    db.commit()
    db.refresh(w)
    return w


def _bump_vendor_no_show(db: Session, vendor_id: str) -> None:
    v = db.get(Vendor, vendor_id)
    if not v:
        return
    v.no_show_rate = min(1.0, (v.no_show_rate or 0) + 0.02)
    db.add(v)
