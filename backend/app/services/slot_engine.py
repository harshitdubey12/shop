"""
Single source of truth for slot contention: holds + confirmed salon bookings.
SQLite friendly (transactional checks, no row-level FOR UPDATE).
"""
from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.config import Settings
from app.models.marketplace import SalonBooking, SlotHistory, SlotHold

logger = logging.getLogger(__name__)


def record_slot_history(
    db: Session,
    *,
    vendor_id: str,
    barber_id: str | None,
    slot_start: int,
    slot_end: int,
    event: str,
    entity_id: str | None,
    meta: dict[str, Any] | None = None,
) -> None:
    h = SlotHistory(
        id=str(uuid.uuid4()),
        created_at=int(time.time()),
        vendor_id=vendor_id,
        barber_id=barber_id,
        slot_start_unix=slot_start,
        slot_end_unix=slot_end,
        event=event,
        entity_id=entity_id,
        meta_json=json.dumps(meta) if meta else None,
    )
    db.add(h)


def blocking_confirmed_booking_exists(
    db: Session,
    *,
    vendor_id: str,
    slot_start: int,
    slot_end: int,
) -> bool:
    # MVP: one concurrent appointment per shop per time window (extend per chair later).
    q = select(SalonBooking.id).where(
        SalonBooking.vendor_id == vendor_id,
        SalonBooking.lifecycle_status.in_(("pending_barber", "confirmed")),
        SalonBooking.slot_start_unix < slot_end,
        SalonBooking.slot_end_unix > slot_start,
    )
    return db.scalar(q.limit(1)) is not None


def _active_hold_conflicts(
    db: Session,
    *,
    vendor_id: str,
    slot_start: int,
    slot_end: int,
    now: int,
) -> bool:
    q = select(SlotHold.id).where(
        SlotHold.vendor_id == vendor_id,
        SlotHold.status == "active",
        SlotHold.expires_at_unix > now,
        SlotHold.slot_start_unix < slot_end,
        SlotHold.slot_end_unix > slot_start,
    )
    return db.scalar(q.limit(1)) is not None


def acquire_hold(
    db: Session,
    settings: Settings,
    *,
    vendor_id: str,
    barber_id: str | None,
    slot_start_unix: int,
    slot_end_unix: int,
    user_id: str,
) -> SlotHold:
    if slot_end_unix <= slot_start_unix:
        raise ValueError("slot end must be after start")

    now = int(time.time())
    if blocking_confirmed_booking_exists(
        db, vendor_id=vendor_id, slot_start=slot_start_unix, slot_end=slot_end_unix
    ):
        raise ValueError("slot already booked")
    if _active_hold_conflicts(
        db,
        vendor_id=vendor_id,
        slot_start=slot_start_unix,
        slot_end=slot_end_unix,
        now=now,
    ):
        raise ValueError("slot temporarily held by another customer")

    hold = SlotHold(
        id=str(uuid.uuid4()),
        created_at=now,
        vendor_id=vendor_id,
        barber_id=barber_id,
        slot_start_unix=slot_start_unix,
        slot_end_unix=slot_end_unix,
        user_id=user_id,
        hold_token=str(uuid.uuid4()),
        expires_at_unix=now + settings.hold_ttl_seconds,
        status="active",
    )
    db.add(hold)
    record_slot_history(
        db,
        vendor_id=vendor_id,
        barber_id=barber_id,
        slot_start=slot_start_unix,
        slot_end=slot_end_unix,
        event="hold_created",
        entity_id=hold.id,
        meta={"user_id": user_id},
    )
    db.commit()
    db.refresh(hold)
    return hold


def get_active_hold(db: Session, hold_token: str, *, now: int | None = None) -> SlotHold | None:
    now = now or int(time.time())
    h = db.scalars(
        select(SlotHold).where(
            SlotHold.hold_token == hold_token,
            SlotHold.status == "active",
            SlotHold.expires_at_unix > now,
        )
    ).first()
    return h


def consume_hold(db: Session, hold: SlotHold) -> None:
    hold.status = "consumed"
    db.add(hold)
    record_slot_history(
        db,
        vendor_id=hold.vendor_id,
        barber_id=hold.barber_id,
        slot_start=hold.slot_start_unix,
        slot_end=hold.slot_end_unix,
        event="hold_consumed",
        entity_id=hold.id,
    )


def expire_stale_holds(db: Session, *, now: int | None = None) -> int:
    now = now or int(time.time())
    rows = list(
        db.scalars(
            select(SlotHold).where(
                SlotHold.status == "active",
                SlotHold.expires_at_unix <= now,
            )
        )
    )
    for h in rows:
        h.status = "expired"
        db.add(h)
        record_slot_history(
            db,
            vendor_id=h.vendor_id,
            barber_id=h.barber_id,
            slot_start=h.slot_start_unix,
            slot_end=h.slot_end_unix,
            event="hold_expired",
            entity_id=h.id,
        )
        logger.info("slot hold expired id=%s vendor=%s", h.id, h.vendor_id)
    db.commit()
    return len(rows)
