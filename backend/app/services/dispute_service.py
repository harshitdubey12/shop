"""Disputes tied to salon bookings; admin resolution; barber fault auto path."""
from __future__ import annotations

import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.controlled_marketplace import Dispute
from app.models.marketplace import SalonBooking
from app.services import slot_engine


def open_dispute(
    db: Session,
    *,
    salon_booking_id: str,
    opened_by: str,
    summary: str | None = None,
) -> Dispute:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb:
        raise ValueError("booking not found")
    now = int(time.time())
    d = Dispute(
        id=str(uuid.uuid4()),
        created_at_unix=now,
        updated_at_unix=now,
        salon_booking_id=salon_booking_id,
        opened_by=opened_by,
        status="open",
        summary=summary,
    )
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def open_barber_fault_auto(
    db: Session,
    *,
    salon_booking_id: str,
    vendor_id: str,
    summary: str | None = None,
) -> tuple[SalonBooking, Dispute]:
    sb = db.get(SalonBooking, salon_booking_id)
    if not sb or sb.vendor_id != vendor_id:
        raise ValueError("booking not found")
    if sb.lifecycle_status not in ("confirmed", "pending_barber"):
        raise ValueError("invalid state for barber fault")
    now = int(time.time())
    sb.lifecycle_status = "cancelled"
    sb.updated_at = now
    db.add(sb)
    slot_engine.record_slot_history(
        db,
        vendor_id=sb.vendor_id,
        barber_id=sb.barber_id,
        slot_start=sb.slot_start_unix,
        slot_end=sb.slot_end_unix,
        event="barber_fault_cancel",
        entity_id=sb.id,
        meta={"refund_platform_fee_recommended_paise": sb.fee_paid_paise},
    )
    d = Dispute(
        id=str(uuid.uuid4()),
        created_at_unix=now,
        updated_at_unix=now,
        salon_booking_id=sb.id,
        opened_by="system_barber_fault",
        status="open",
        summary=summary or "Barber side fault cancel; refund platform fee if captured",
    )
    db.add(d)
    db.commit()
    db.refresh(sb)
    db.refresh(d)
    from app.services.booking_service import offer_waitlist_on_slot_freed

    offer_waitlist_on_slot_freed(
        db, vendor_id=sb.vendor_id, slot_start=sb.slot_start_unix, slot_end=sb.slot_end_unix
    )
    return sb, d


def resolve_dispute(
    db: Session,
    *,
    dispute_id: str,
    resolution_notes: str,
    new_status: str = "resolved",
) -> Dispute:
    d = db.get(Dispute, dispute_id)
    if not d:
        raise ValueError("dispute not found")
    d.status = new_status
    d.resolution_notes = resolution_notes
    d.updated_at_unix = int(time.time())
    db.add(d)
    db.commit()
    db.refresh(d)
    return d


def list_open_disputes(db: Session, *, limit: int = 50) -> list[Dispute]:
    return list(
        db.scalars(
            select(Dispute).where(Dispute.status == "open").order_by(Dispute.created_at_unix.asc()).limit(limit)
        )
    )


def dispute_bundle_for_admin(db: Session, dispute_id: str) -> dict[str, Any]:
    d = db.get(Dispute, dispute_id)
    if not d:
        raise ValueError("dispute not found")
    sb = db.get(SalonBooking, d.salon_booking_id)
    return {
        "dispute": {
            "id": d.id,
            "status": d.status,
            "opened_by": d.opened_by,
            "summary": d.summary,
            "resolution_notes": d.resolution_notes,
            "created_at_unix": d.created_at_unix,
        },
        "booking": (
            {
                "id": sb.id,
                "lifecycle_status": sb.lifecycle_status,
                "payment_status": sb.payment_status,
                "fee_paid_paise": sb.fee_paid_paise,
                "platform_fee_paise": sb.platform_fee_paise,
                "slot_start_unix": sb.slot_start_unix,
                "customer_arrival_confirmed_at_unix": sb.customer_arrival_confirmed_at_unix,
            }
            if sb
            else None
        ),
    }
