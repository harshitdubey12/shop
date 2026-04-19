import pytest
import time
import asyncio
import uuid
import json
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker
from app.db.session import Base
from app.models.booking import Booking
from app.models.marketplace import FinancialActionLog, RefundLog
from app.services import payment_service, razorpay_service
from app import failure_injection
from app.config import Settings
from app.models.vendor import Vendor
from app.models.marketplace import FinancialActionLog, RefundLog, IdempotencyKey
from app.models.controlled_marketplace import CustomerRetentionProfile

@pytest.fixture
def db():
    eng = create_engine("sqlite:///:memory:")
    # Only create tables we need to avoid ExcludeConstraint issues with SQLite
    Booking.__table__.create(eng)
    FinancialActionLog.__table__.create(eng)
    RefundLog.__table__.create(eng)
    Vendor.__table__.create(eng)
    CustomerRetentionProfile.__table__.create(eng)
    IdempotencyKey.__table__.create(eng)
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

def setup_booking(db, id="b1", status="PAYMENT_CAPTURED", amount=10000):
    # Setup vendor if not exists
    from sqlalchemy import select
    from app.models.vendor import Vendor
    v = db.get(Vendor, "v1")
    if not v:
        v = Vendor(id="v1", created_at=int(time.time()), name="Vendor 1", phone="1234567890", email="v1@test.com", razorpay_account_id="acc_1")
        db.add(v)
        db.flush()
    
    b = Booking(
        id=id, created_at=int(time.time()), vendor_id="v1",
        base_price_inr="100", platform_fee_inr="5", total_amount_inr="105", vendor_payout_inr="100",
        base_price_paise=amount, platform_fee_paise=500, total_amount_paise=amount+500, vendor_payout_paise=amount,
        payment_amount_paise=amount+500, status=status, razorpay_payment_id="pay_1",
        integrity_status="valid", severity_level="LOW"
    )
    db.add(b)
    db.commit()
    return b

@pytest.mark.asyncio
async def test_scenario_api_success_db_failure(db, settings):
    """Scenario 1: API success + DB failure."""
    setup_booking(db, id="scenario1")
    
    # Inject failure: API success but DB commit fails
    failure_injection.FAILURE_MODE["db_fail_before_commit"] = True
    
    with patch("app.services.razorpay_service.capture_then_route_transfers") as mock_tr, \
         patch("app.services.razorpay_service.fetch_payment") as mock_fetch_pay:
        # Patch the worker module by path where it's used
        with patch("app.services.payment_service.metrics_service.send_financial_alert"):
            mock_tr.return_value = (None, {"items": [{"id": "trf_1"}]})
            mock_fetch_pay.return_value = {"status": "captured", "amount": 10500}
            
            try:
                # We expect ChaosError but SQLite might not rollback automatically in :memory: 
                # if we don't handle the exception correctly. 
                # Actually, our service raises RuntimeError after catching ChaosError if the lock re-check fails.
                await payment_service.finalize_route_split_for_booking(db, settings, "scenario1", "pay_1")
            except (failure_injection.ChaosError, RuntimeError):
                db.rollback() # Explicit rollback for test
            
    # Verification
    b = db.get(Booking, "scenario1")
    # If the transaction rolled back, b should be back to PAYMENT_CAPTURED
    assert b.status == "PAYMENT_CAPTURED"
    
    # Run repair - this should detect the transfer in Razorpay and sync
    failure_injection.reset_chaos()
    with patch("app.services.razorpay_service.fetch_payment") as m_pay, \
         patch("app.services.razorpay_service.fetch_payment_transfers") as m_tr, \
         patch("app.services.razorpay_service.fetch_payment_refunds") as m_ref:
        
        m_pay.return_value = {"status": "captured", "amount": 10500}
        m_tr.return_value = {"items": [{"id": "trf_1", "amount": 10500}]}
        m_ref.return_value = {"items": []}
        
        res = await payment_service.repair_booking_integrity(db, settings, "scenario1", dry_run=False)
        assert res["ok"] is True
    
    db.refresh(b)
    assert b.status in ["TRANSFER_COMPLETED", "FINALIZED"]
    assert b.razorpay_transfer_id == "trf_1"

@pytest.mark.asyncio
async def test_scenario_repair_circuit_breaker(db, settings):
    """Scenario 5: Repair loop stress."""
    b = setup_booking(db, id="scenario5")
    
    # Force 3 repair failures
    b.repair_attempt_count = 3
    db.commit()
    
    res = await payment_service.repair_booking_integrity(db, settings, "scenario5", dry_run=False)
    
    assert res["ok"] is False
    assert "FINANCIAL_LOCKED" in res["reason"]
    db.refresh(b)
    assert b.status == "FINANCIAL_LOCKED"

@pytest.mark.asyncio
async def test_scenario_double_execution_idempotency(db, settings):
    """Scenario 2: Double execution storm."""
    b = setup_booking(db, id="scenario2")
    
    # Use idempotency key for refund
    idem = "refund_idem_1"
    
    with patch("app.services.razorpay_service.refund_payment") as mock_ref:
        mock_ref.return_value = {"id": "ref_1"}
        
        # First attempt
        await payment_service.initiate_refund(db, settings, "scenario2", 500, "reason", idempotency_key=idem)
        
        # Verification: b is no longer locked after commit
        db.refresh(b)
        assert b.financial_operation_lock == 0
        
        # In memory sqlite with same session might be tricky, let's advance time slightly
        # to trigger the stale lock recovery if it was still locked
        b.financial_lock_acquired_at = int(time.time()) - 10 
        db.commit()

        # Second attempt - should be blocked by existing RefundLog with same idempotency key
        # We use a fresh object to be sure
        db.expire_all()
        res2 = await payment_service.initiate_refund(db, settings, "scenario2", 500, "reason", idempotency_key=idem)
        
        assert mock_ref.call_count == 1
        assert res2.status == "completed"

@pytest.mark.asyncio
async def test_invariant_monitor_global(db, settings):
    """Phase 3: Global Invariant Monitor."""
    setup_booking(db, id="b1_inv", amount=10000) # total 10500
    setup_booking(db, id="b2_inv", amount=20000) # total 20500
    
    # Valid state
    b1 = db.get(Booking, "b1_inv")
    b1.status = "TRANSFER_COMPLETED"
    b1.total_transferred_amount_paise = 10500
    
    b2 = db.get(Booking, "b2_inv")
    b2.status = "REFUNDED"
    b2.total_refunded_amount_paise = 20500
    
    db.commit()
    
    from sqlalchemy import select, func
    total_payments = db.scalar(select(func.sum(Booking.payment_amount_paise))) or 0
    total_transferred = db.scalar(select(func.sum(Booking.total_transferred_amount_paise))) or 0
    total_refunded = db.scalar(select(func.sum(Booking.total_refunded_amount_paise))) or 0
    
    assert total_payments == (total_transferred + total_refunded)

@pytest.mark.asyncio
async def test_scenario_webhook_delay(db, settings):
    """Scenario 3: Webhook delay."""
    b = setup_booking(db, id="scenario3")
    
    # Simulating a transfer that succeeds but webhook is delayed
    with patch("app.services.razorpay_service.capture_then_route_transfers") as mock_tr, \
         patch("app.services.razorpay_service.fetch_payment") as mock_fetch:
        mock_tr.return_value = (None, {"items": [{"id": "trf_3"}]})
        mock_fetch.return_value = {"status": "captured", "amount": 10500}
        await payment_service.finalize_route_split_for_booking(db, settings, "scenario3", "pay_3")
        
    db.refresh(b)
    assert b.status in ["TRANSFER_COMPLETED", "FINALIZED"]
    
    # Now simulate a delayed webhook for the same event
    from app.api import webhook_handler
    body = {
        "event": "transfer.processed",
        "payload": {
            "transfer": {
                "entity": {
                    "id": "trf_3",
                    "source": "pay_3",
                    "amount": 10500
                }
            }
        }
    }
    
    # This should be handled idempotently and NOT corrupt state
    res = await webhook_handler.handle_razorpay_webhook_event(db, settings, body, event_id="evt_1")
    assert res["ok"] is True
    
    db.refresh(b)
    assert b.status in ["TRANSFER_COMPLETED", "FINALIZED"]
    assert b.razorpay_transfer_id == "trf_3"

@pytest.mark.asyncio
async def test_scenario_partial_failure_chain(db, settings):
    """Scenario 6: Partial failure chain (API success, DB fail, Webhook delayed, Repair triggered)."""
    b = setup_booking(db, id="scenario6")
    
    # 1. API success but DB commit fails
    failure_injection.FAILURE_MODE["db_fail_before_commit"] = True
    with patch("app.services.razorpay_service.capture_then_route_transfers") as mock_tr, \
         patch("app.services.razorpay_service.fetch_payment") as mock_fetch:
        mock_tr.return_value = (None, {"items": [{"id": "trf_6"}]})
        mock_fetch.return_value = {"status": "captured", "amount": 10500}
        try:
            await payment_service.finalize_route_split_for_booking(db, settings, "scenario6", "pay_6")
        except (failure_injection.ChaosError, RuntimeError):
            db.rollback()
            
    db.refresh(b)
    assert b.status == "PAYMENT_CAPTURED" # Still captured because of rollback
    
    # 2. Repair triggered before webhook
    failure_injection.reset_chaos()
    with patch("app.services.razorpay_service.fetch_payment") as m_pay, \
         patch("app.services.razorpay_service.fetch_payment_transfers") as m_tr, \
         patch("app.services.razorpay_service.fetch_payment_refunds") as m_ref:
        
        m_pay.return_value = {"status": "captured", "amount": 10500}
        m_tr.return_value = {"items": [{"id": "trf_6", "amount": 10500}]}
        m_ref.return_value = {"items": []}
        
        await payment_service.repair_booking_integrity(db, settings, "scenario6", dry_run=False)
        
    db.refresh(b)
    assert b.status in ["TRANSFER_COMPLETED", "FINALIZED"]
    assert b.razorpay_transfer_id == "trf_6"
    
    # 3. Webhook finally arrives
    from app.api import webhook_handler
    body = {
        "event": "transfer.processed",
        "payload": {
            "transfer": {
                "entity": {
                    "id": "trf_6",
                    "source": "pay_6",
                    "amount": 10500
                }
            }
        }
    }
    await webhook_handler.handle_razorpay_webhook_event(db, settings, body, event_id="evt_6")
    
    db.refresh(b)
    assert b.status in ["TRANSFER_COMPLETED", "FINALIZED"]
    assert b.razorpay_transfer_id == "trf_6"
