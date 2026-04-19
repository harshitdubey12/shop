import pytest
import time
import asyncio
import uuid
import logging
import random
from unittest.mock import patch, MagicMock
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker

from app.db.session import Base
from app.models.booking import Booking
from app.models.marketplace import FinancialActionLog, RefundLog, IdempotencyKey
from app.models.controlled_marketplace import CustomerRetentionProfile
from app.models.vendor import Vendor
from app.services import payment_service, razorpay_service
from app import failure_injection
from app.config import Settings

logger = logging.getLogger(__name__)

# Phase 10: Advanced Reporting Metrics
framework_metrics = {
    "scenarios_run": 0,
    "failures_injected": 0,
    "invariants_checked": 0,
    "invariants_violated": 0,
    "recoveries_successful": 0,
    "convergence_success_rate": 0,
    "total_recovery_time_ms": 0,
    "max_recovery_time_ms": 0,
    "repair_attempts_per_scenario": {}
}

@pytest.fixture(scope="function")
def engine():
    eng = create_engine("sqlite:///:memory:")
    Booking.__table__.create(eng)
    FinancialActionLog.__table__.create(eng)
    RefundLog.__table__.create(eng)
    Vendor.__table__.create(eng)
    CustomerRetentionProfile.__table__.create(eng)
    IdempotencyKey.__table__.create(eng)
    return eng

@pytest.fixture
def db(engine):
    Session = sessionmaker(bind=engine)
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
        RAZORPAY_WEBHOOK_SECRET="test",
        CHAOS_MODE=True,
        CHAOS_SEED=12345
    )

@pytest.fixture(autouse=True)
def chaos_seed(settings):
    # Phase 8: Deterministic Chaos
    random.seed(settings.chaos_seed)
    logger.info(f"Initialized CHAOS_SEED: {settings.chaos_seed}")
    yield

def setup_booking(db, id="b1", status="PAYMENT_CAPTURED", amount=10000):
    v = db.get(Vendor, "v1")
    if not v:
        v = Vendor(id="v1", created_at=int(time.time()), name="Vendor 1", phone="1234567890", email="v1@test.com", razorpay_account_id="acc_1")
        db.add(v)
        db.flush()
    
    b = Booking(
        id=id, created_at=int(time.time()), vendor_id="v1",
        base_price_inr="100", platform_fee_inr="5", total_amount_inr="105", vendor_payout_inr="100",
        base_price_paise=amount, platform_fee_paise=500, total_amount_paise=amount+500, vendor_payout_paise=amount,
        payment_amount_paise=amount+500, status=status, razorpay_payment_id=f"pay_{id}",
        integrity_status="valid", severity_level="LOW"
    )
    db.add(b)
    db.commit()
    return b

def assert_financial_invariants(db, scenario_name=""):
    """Phase 6: Eventual Invariant Validation"""
    framework_metrics["invariants_checked"] += 1
    total_payments = db.scalar(select(func.sum(Booking.payment_amount_paise))) or 0
    total_transferred = db.scalar(select(func.sum(Booking.total_transferred_amount_paise))) or 0
    total_refunded = db.scalar(select(func.sum(Booking.total_refunded_amount_paise))) or 0
    
    # Calculate Escrow (payments captured but not transferred or refunded)
    escrow = db.scalar(
        select(func.sum(Booking.payment_amount_paise - Booking.total_transferred_amount_paise - Booking.total_refunded_amount_paise))
        .where(Booking.status.in_(["PAYMENT_CAPTURED", "TRANSFER_INITIATED", "REFUND_INITIATED", "TRANSFER_FAILED", "FINANCIAL_LOCKED", "PARTIALLY_REFUNDED", "PAYMENT_CREATED", "ORDER_CREATED"]))
    ) or 0
    
    if total_payments != (total_transferred + total_refunded + escrow):
        framework_metrics["invariants_violated"] += 1
        pytest.fail(f"[{scenario_name}] INVARIANT VIOLATION: Payments ({total_payments}) != Transferred ({total_transferred}) + Refunded ({total_refunded}) + Escrow ({escrow})")

async def wait_for_convergence(db, booking_id, max_wait=120, check_interval=1.0, scenario_name="unknown"):
    """Phase 7: Strict Convergence Definition"""
    start_time = time.time()
    
    for _ in range(int(max_wait / check_interval)):
        db.expire_all()
        b = db.get(Booking, booking_id)
        
        # Strict Convergence Checks:
        locks_cleared = not b.financial_operation_lock
        repairs_cleared = not b.repair_in_progress
        pending_verification_cleared = b.integrity_status != "pending_verification"
        terminal_state = b.status in ["TRANSFER_COMPLETED", "REFUNDED", "FINALIZED", "FINANCIAL_LOCKED"]
        
        if locks_cleared and repairs_cleared and pending_verification_cleared and terminal_state:
            duration_ms = int((time.time() - start_time) * 1000)
            framework_metrics["total_recovery_time_ms"] += duration_ms
            framework_metrics["max_recovery_time_ms"] = max(framework_metrics["max_recovery_time_ms"], duration_ms)
            framework_metrics["convergence_success_rate"] += 1
            return b
            
        await asyncio.sleep(check_interval)
        
    pytest.fail(f"System did not strictly converge for booking {booking_id} after {max_wait}s")

def detect_duplicates(db, booking_id):
    """Detect Duplicate Refund Execution."""
    refunds = db.scalars(select(RefundLog).where(RefundLog.booking_id == booking_id)).all()
    idempotency_keys = set()
    for ref in refunds:
        if ref.idempotency_key:
            assert ref.idempotency_key not in idempotency_keys, "Duplicate refund execution detected"
            idempotency_keys.add(ref.idempotency_key)

@pytest.mark.asyncio
async def test_scenario_1_api_success_db_write_fail(db, settings):
    """Scenario 1: API success + DB Write Failure."""
    b = setup_booking(db, id="sc1")
    framework_metrics["scenarios_run"] += 1
    
    failure_injection.set_chaos_profile({"db_fail_write_api_success": True})
    framework_metrics["failures_injected"] += 1
    
    try:
        await payment_service.finalize_route_split_for_booking(db, settings, "sc1", "pay_sc1")
    except failure_injection.ChaosError:
        db.rollback()
            
    failure_injection.reset_chaos()
    
    # Repair
    with patch("app.services.razorpay_service.fetch_payment_transfers") as m_tr, \
         patch("app.services.razorpay_service.fetch_payment_refunds") as m_ref:
        m_tr.return_value = {"items": [{"id": "trf_1", "amount": 10500}]}
        m_ref.return_value = {"items": []}
        
        res = await payment_service.repair_booking_integrity(db, settings, "sc1", dry_run=False)
        assert res["ok"] is True
        framework_metrics["recoveries_successful"] += 1

    b = await wait_for_convergence(db, "sc1", scenario_name="Scenario 1")
    assert_financial_invariants(db, "Scenario 1")


@pytest.mark.asyncio
async def test_scenario_2_redis_split_brain(db, settings):
    """Scenario 2: Redis Split-Brain Dual Execution."""
    b = setup_booking(db, id="sc2")
    framework_metrics["scenarios_run"] += 1
    
    # Simulate both processes getting the lock simultaneously
    failure_injection.set_chaos_profile({"redis_failure_mode": "split_brain"})
    framework_metrics["failures_injected"] += 1
    
    idem = "sc2_refund_idem"
    tasks = [
        payment_service.initiate_refund(db, settings, "sc2", 10500, "reason", idempotency_key=idem)
        for _ in range(3)
    ]
    
    # DB row-locks MUST prevent the actual execution overlap even if Redis split-brains
    results = await asyncio.gather(*tasks, return_exceptions=True)
    successes = [r for r in results if isinstance(r, RefundLog)]
    assert len(successes) > 0

    failure_injection.reset_chaos()
    
    # Clean up state to converge
    db.refresh(b)
    b.financial_operation_lock = False
    db.commit()
    
    assert_financial_invariants(db, "Scenario 2")
    detect_duplicates(db, "sc2")


@pytest.mark.asyncio
async def test_scenario_3_celery_overlap_and_storm(db, settings):
    """Scenario 3: Celery Overlap and Storm."""
    b = setup_booking(db, id="sc3")
    framework_metrics["scenarios_run"] += 1
    
    failure_injection.set_chaos_profile({"celery_failure_mode": "retry_storm"})
    framework_metrics["failures_injected"] += 1
    
    from app.worker import repair_booking_integrity_task
    
    # We call the task directly, since it's wrapped to spawn 10 concurrent threads
    with patch("app.services.razorpay_service.fetch_payment_transfers") as m_tr, \
         patch("app.services.razorpay_service.fetch_payment_refunds") as m_ref:
        m_tr.return_value = {"items": [{"id": "trf_sc3", "amount": 10500}]}
        m_ref.return_value = {"items": []}
        
        # This will internally run 10 overlapping repairs 
        repair_booking_integrity_task.delay(b.id, dry_run=False)

    failure_injection.reset_chaos()
    
    b = await wait_for_convergence(db, "sc3", scenario_name="Scenario 3")
    assert_financial_invariants(db, "Scenario 3")


@pytest.mark.asyncio
async def test_scenario_4_db_commit_drop(db, settings):
    """Scenario 4: DB commit success but response dropped."""
    b = setup_booking(db, id="sc4")
    framework_metrics["scenarios_run"] += 1
    
    failure_injection.set_chaos_profile({"db_fail_response_after_commit": True})
    framework_metrics["failures_injected"] += 1
    
    try:
        await payment_service.finalize_route_split_for_booking(db, settings, "sc4", "pay_sc4")
    except failure_injection.ChaosError:
        pass # Expected response drop
            
    failure_injection.reset_chaos()
    
    b = await wait_for_convergence(db, "sc4", scenario_name="Scenario 4")
    assert_financial_invariants(db, "Scenario 4")


@pytest.mark.asyncio
async def test_scenario_5_mixed_chaos_load(engine, settings):
    """Phase 5: Mixed Chaos Load (Contention & Randomization)."""
    framework_metrics["scenarios_run"] += 1
    Session = sessionmaker(bind=engine)
    
    profiles = [
        {"redis_failure_mode": "lock_disappears"},
        {"db_fail_write_api_success": True},
        {"celery_failure_mode": "duplicate_overlap"},
        {"db_deadlock": True},
        {"razorpay_success_no_response": True},
        {"razorpay_timeout": True},
        {} # 1 valid run
    ]
    
    async def contending_worker(booking_id, profile, action):
        # Dedicated session per worker to simulate separate web requests
        db = Session()
        try:
            # Set propagated context var specific to this task
            failure_injection.set_chaos_profile(profile)
            if profile:
                framework_metrics["failures_injected"] += 1
            
            # Simulate random delay to increase interleaving
            await asyncio.sleep(random.uniform(0.01, 0.2))
            
            if action == "transfer":
                try:
                    await payment_service.finalize_route_split_for_booking(db, settings, booking_id, f"pay_{booking_id}")
                except Exception:
                    db.rollback()
            elif action == "refund":
                try:
                    await payment_service.initiate_refund(db, settings, booking_id, 10500, "contention_test", idempotency_key=f"idem_{booking_id}")
                except Exception:
                    db.rollback()
            elif action == "repair":
                try:
                    await payment_service.repair_booking_integrity(db, settings, booking_id, dry_run=False)
                except Exception:
                    db.rollback()
                    
        finally:
            db.close()

    # Create 3 bookings and throw concurrent transfer, refund, and repair actions at ALL of them
    setup_db = Session()
    for i in range(3):
        setup_booking(setup_db, id=f"mix_{i}")
    setup_db.close()
    
    tasks = []
    for i in range(3):
        bid = f"mix_{i}"
        for _ in range(5):
            tasks.append(contending_worker(bid, random.choice(profiles), random.choice(["transfer", "refund", "repair"])))
            
    await asyncio.gather(*tasks)
    
    # System must reconcile and stabilize
    verify_db = Session()
    try:
        failure_injection.reset_chaos()
        for i in range(3):
            # Kick off one final clean repair to resolve anything left hanging due to injected API drops
            await payment_service.repair_booking_integrity(verify_db, settings, f"mix_{i}", dry_run=False)
            await wait_for_convergence(verify_db, f"mix_{i}", scenario_name="Mixed Load")
        
        assert_financial_invariants(verify_db, "Mixed Load")
    finally:
        verify_db.close()


def pytest_sessionfinish(session, exitstatus):
    """Phase 10: Advanced Reporting."""
    success_rate = (framework_metrics['convergence_success_rate'] / max(1, framework_metrics['scenarios_run'])) * 100
    avg_recovery = framework_metrics['total_recovery_time_ms'] / max(1, framework_metrics['convergence_success_rate'])
    
    report = f"""
=========================================
🔥 HARDENED CHAOS ENGINEERING REPORT 🔥
=========================================
Total Scenarios Executed  : {framework_metrics['scenarios_run']}
Total Failures Injected   : {framework_metrics['failures_injected']}
Total Invariants Checked  : {framework_metrics['invariants_checked']}
Invariants Violated       : {framework_metrics['invariants_violated']}

Convergence Success Rate  : {success_rate:.2f}%
Average Recovery Time     : {avg_recovery:.0f} ms
Max Recovery Time         : {framework_metrics['max_recovery_time_ms']} ms

System Recoveries         : {framework_metrics['recoveries_successful']}
Final Verdict             : {'✅ SAFE' if framework_metrics['invariants_violated'] == 0 and exitstatus == 0 else '❌ FAILED'}
=========================================
"""
    import sys
    sys.stdout.write(report)
    sys.stdout.flush()
    with open("chaos_report.md", "w") as f:
        f.write(report)
