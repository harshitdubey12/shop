import pytest
import time
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.db.session import Base
from app.models.booking import Booking
from app.models.marketplace import RefundLog
from app.services.payment_service import initiate_refund, finalize_route_split_for_booking
from app.config import Settings

@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:")
    # Only create the tables we need for these tests to avoid ExcludeConstraint issues with SQLite
    Booking.__table__.create(eng)
    RefundLog.__table__.create(eng)
    Session = sessionmaker(bind=eng)
    session = Session()
    try:
        yield session
    finally:
        session.close()

@pytest.fixture
def settings():
    return Settings(
        razorpay_key_id="test",
        razorpay_key_secret="test",
        razorpay_webhook_secret="test",
        RAZORPAY_KEY_ID="test",
        RAZORPAY_KEY_SECRET="test",
        RAZORPAY_WEBHOOK_SECRET="test"
    )

@pytest.mark.asyncio
async def test_double_refund_protection(db, settings):
    # Setup
    b = Booking(
        id="b1", created_at=int(time.time()), vendor_id="v1",
        base_price_inr="100", platform_fee_inr="5", total_amount_inr="105", vendor_payout_inr="100",
        base_price_paise=10000, platform_fee_paise=500, total_amount_paise=10500, vendor_payout_paise=10000,
        payment_amount_paise=10500, status="PAYMENT_CAPTURED", razorpay_payment_id="pay_1"
    )
    db.add(b)
    db.commit()

    with patch("app.services.razorpay_service.refund_payment") as mock_refund:
        mock_refund.return_value = {"id": "ref_1"}
        
        # First refund
        await initiate_refund(db, settings, "b1", 5000, "reason", idempotency_key="idem_1")
        
        # Second refund with same idempotency key
        res2 = await initiate_refund(db, settings, "b1", 5000, "reason", idempotency_key="idem_1")
        
        assert mock_refund.call_count == 1
        assert res2.idempotency_key == "idem_1"

@pytest.mark.asyncio
async def test_transfer_refund_block(db, settings):
    # Setup
    b = Booking(
        id="b2", created_at=int(time.time()), vendor_id="v1",
        base_price_inr="100", platform_fee_inr="5", total_amount_inr="105", vendor_payout_inr="100",
        base_price_paise=10000, platform_fee_paise=500, total_amount_paise=10500, vendor_payout_paise=10000,
        payment_amount_paise=10500, status="TRANSFER_INITIATED", razorpay_payment_id="pay_2"
    )
    db.add(b)
    db.commit()

    # Attempt refund while transfer is initiated
    with pytest.raises(ValueError, match="has transfer status"):
        await initiate_refund(db, settings, "b2", 1000, "reason")

@pytest.mark.asyncio
async def test_financial_invariant_violation(db, settings):
    # Setup
    b = Booking(
        id="b3", created_at=int(time.time()), vendor_id="v1",
        base_price_inr="100", platform_fee_inr="5", total_amount_inr="105", vendor_payout_inr="100",
        base_price_paise=10000, platform_fee_paise=500, total_amount_paise=10500, vendor_payout_paise=10000,
        payment_amount_paise=10500, status="PAYMENT_CAPTURED", razorpay_payment_id="pay_3"
    )
    db.add(b)
    db.commit()

    with patch("app.services.razorpay_service.refund_payment") as mock_refund:
        # Force an inconsistent state where we refund but don't update booking correctly (simulating a bug or manual intervention)
        mock_refund.return_value = {"id": "ref_3"}
        
        # This will call validate_financial_invariant
        # If we somehow bypassed the total_refunded_amount_paise update but the state moved to REFUNDED
        b.status = "REFUNDED"
        b.total_refunded_amount_paise = 5000 # Should be 10500
        
        from app.services.payment_service import validate_financial_invariant
        with pytest.raises(RuntimeError, match="Financial invariant violation"):
            validate_financial_invariant(b)
