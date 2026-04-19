import pytest
from unittest.mock import MagicMock, patch
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.session import Base
from app.worker import verify_booking_integrity
from app.models.booking import Booking
from app.models.marketplace import RefundLog, SalonBooking
from app.models.vendor import Vendor
import time
import os

# Setup for testing
os.environ["RAZORPAY_KEY_ID"] = "rzp_test_dummy"
os.environ["RAZORPAY_KEY_SECRET"] = "dummy_secret"
os.environ["RAZORPAY_WEBHOOK_SECRET"] = "whsec_dummy"

@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(eng)
    Session = sessionmaker(bind=eng)
    session = Session()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture
def mock_razorpay_verify():
    with patch("app.services.razorpay_service.verify_payment_integrity") as m:
        m.return_value = {"valid": True, "mismatches": [], "razorpay_state": {}}
        yield m

@pytest.fixture
def mock_session_local(db):
    with patch("app.worker.SessionLocal", return_value=db):
        yield db

def test_verify_booking_integrity_valid(mock_session_local, mock_razorpay_verify):
    db = mock_session_local
    # Setup a valid booking
    b = Booking(
        id="test_valid",
        created_at=int(time.time()),
        vendor_id="v1",
        base_price_inr="100.00",
        platform_fee_inr="5.00",
        total_amount_inr="105.00",
        vendor_payout_inr="100.00",
        base_price_paise=10000,
        platform_fee_paise=500,
        total_amount_paise=10500,
        vendor_payout_paise=10000,
        status="TRANSFER_COMPLETED",
        razorpay_payment_id="pay_1",
        razorpay_transfer_id="trf_1",
        integrity_status="pending_verification"
    )
    db.add(b)
    db.commit()

    verify_booking_integrity()
    
    db.refresh(b)
    assert b.integrity_status == "valid"

def test_verify_booking_integrity_mismatch_captured(mock_session_local, mock_razorpay_verify):
    db = mock_session_local
    # PAYMENT_CAPTURED but no refund/transfer
    b = Booking(
        id="test_mismatch",
        created_at=int(time.time()),
        vendor_id="v1",
        base_price_inr="100.00",
        platform_fee_inr="5.00",
        total_amount_inr="105.00",
        vendor_payout_inr="100.00",
        base_price_paise=10000,
        platform_fee_paise=500,
        total_amount_paise=10500,
        vendor_payout_paise=10000,
        status="PAYMENT_CAPTURED",
        razorpay_payment_id="pay_2",
        integrity_status="pending_verification"
    )
    db.add(b)
    db.commit()

    verify_booking_integrity()
    
    db.refresh(b)
    assert b.integrity_status == "mismatch_detected"

def test_verify_booking_integrity_mismatch_transfer_id(mock_session_local, mock_razorpay_verify):
    db = mock_session_local
    # TRANSFER_COMPLETED but missing transfer_id
    b = Booking(
        id="test_missing_trf",
        created_at=int(time.time()),
        vendor_id="v1",
        base_price_inr="100.00",
        platform_fee_inr="5.00",
        total_amount_inr="105.00",
        vendor_payout_inr="100.00",
        base_price_paise=10000,
        platform_fee_paise=500,
        total_amount_paise=10500,
        vendor_payout_paise=10000,
        status="TRANSFER_COMPLETED",
        razorpay_payment_id="pay_3",
        integrity_status="pending_verification"
    )
    db.add(b)
    db.commit()

    verify_booking_integrity()
    
    db.refresh(b)
    assert b.integrity_status == "mismatch_detected"
