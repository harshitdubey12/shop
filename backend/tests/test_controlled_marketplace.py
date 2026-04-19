"""Controlled marketplace: fee copy, cancel cutoff, reminders schedule."""
from __future__ import annotations

import time

import pytest
from sqlalchemy import create_engine
from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from app.config import Settings
from app.db.session import Base
from app.models.marketplace import ReminderJob, SalonBooking
from app.services import booking_service, fee_policy_service, reminder_service


def _settings() -> Settings:
    return Settings(
        razorpay_key_id="rzp_test_x",
        razorpay_key_secret="sec",
        razorpay_webhook_secret="whsec_x",
        admin_api_key="admin",
        database_url="sqlite:///:memory:",
        cancel_cutoff_seconds=7200,
        first_booking_fee_waived=True,
    )


def test_fee_preview_includes_explanation() -> None:
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    try:
        prev = fee_policy_service.preview_platform_fee(
            _settings(),
            db,
            user_id="user_a",
            service_price_paise=15_000,
            slot_start_unix=int(time.time()) + 86400,
            risky_slot=False,
        )
        assert prev.fee_explanation
        assert prev.value_proposition_line
        assert "Convenience" in prev.value_proposition_line
    finally:
        db.close()


def test_customer_cancel_inside_cutoff_rejected() -> None:
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    settings = _settings()
    now = int(time.time())
    try:
        sb = SalonBooking(
            id="b1",
            created_at=now,
            updated_at=now,
            user_id="u1",
            vendor_id="v1",
            barber_id=None,
            slot_start_unix=now + 3600,
            slot_end_unix=now + 3900,
            lifecycle_status="confirmed",
            payment_phase=1,
            payment_status="platform_fee_paid",
            service_price_paise=10_000,
            platform_fee_paise=500,
            fee_paid_paise=500,
            source="app",
            customer_phone_masked="******1234",
            customer_phone_hash="h" * 64,
        )
        db.add(sb)
        db.commit()
        with pytest.raises(ValueError, match="late cancel"):
            booking_service.cancel_salon_booking_customer(
                db, settings, salon_booking_id="b1", user_id="u1", now_unix=now
            )
    finally:
        db.close()


def test_schedule_reminders_three_channels() -> None:
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    db = sessionmaker(bind=eng)()
    now = int(time.time())
    try:
        sb = SalonBooking(
            id="b2",
            created_at=now,
            updated_at=now,
            user_id="u1",
            vendor_id="v1",
            barber_id=None,
            slot_start_unix=now + 3 * 86400,
            slot_end_unix=now + 3 * 86400 + 1800,
            lifecycle_status="confirmed",
            payment_phase=1,
            payment_status="awaiting_platform_fee",
            service_price_paise=10_000,
            platform_fee_paise=500,
            fee_paid_paise=0,
            source="app",
            customer_phone_masked=None,
            customer_phone_hash=None,
        )
        db.add(sb)
        db.commit()
        reminder_service.schedule_default_reminders(db, sb)
        n = int(db.scalar(select(func.count()).select_from(ReminderJob)) or 0)
        assert n == 3
    finally:
        db.close()

