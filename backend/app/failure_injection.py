import os
import random
import logging
import asyncio
from typing import Any
import contextvars

logger = logging.getLogger(__name__)

# Phase 1: ContextVar based Failure Mode Configuration
# This allows concurrent tests (Phase 7) to have different failure modes
chaos_context = contextvars.ContextVar('chaos_context', default={})

class ChaosError(Exception):
    """Exception raised by failure injection."""
    pass

def set_chaos(mode: str, value: Any = True):
    ctx = dict(chaos_context.get())
    ctx[mode] = value
    chaos_context.set(ctx)

def get_chaos(mode: str) -> Any:
    return chaos_context.get().get(mode, None)

def set_chaos_profile(profile: dict):
    """Sets multiple chaos settings from a propagated profile (e.g. from headers)"""
    ctx = dict(chaos_context.get())
    ctx.update(profile)
    chaos_context.set(ctx)

# Keeping this for backward compatibility with existing tests
FAILURE_MODE = {
    "razorpay_timeout": False,
    "razorpay_success_no_response": False,
    "razorpay_duplicate_response": False,
    "db_fail_before_commit": False,
    "db_fail_after_write": False,
    "db_deadlock": False,
    "redis_lock_drop": False,
    "redis_restart": False,
    "celery_duplicate_execution": False,
    "celery_delayed_execution": False,
    "celery_retry_storm": False
}

def should_fail(mode: str) -> Any:
    # 1. Context layer (includes propagated profile set via middleware/celery)
    ctx_val = chaos_context.get().get(mode, None)
    if ctx_val is not None:
        return ctx_val
    
    # 2. Fallback layer
    return FAILURE_MODE.get(mode, False)

def reset_chaos():
    for key in FAILURE_MODE:
        FAILURE_MODE[key] = False
    chaos_context.set({})

async def inject_razorpay_failure(mode: str, fallback_result: Any = None):
    if should_fail("razorpay_timeout"):
        logger.warning("Chaos: Simulating Razorpay Timeout")
        await asyncio.sleep(2) # Reduced for faster testing, but simulates timeout
        raise ChaosError("Razorpay API Timeout (Injected)")
    
    if should_fail("razorpay_success_no_response"):
        logger.warning("Chaos: Simulating API success but connection drop before response")
        # In this mode, the action happened but the client doesn't know
        raise ChaosError("Connection dropped after API success (Injected)")

    if should_fail("razorpay_duplicate_response"):
        logger.warning("Chaos: Simulating duplicate API response")
        # Ensure fallback_result is returned twice, meaning it must be a list/tuple to simulate duplicate
        return [fallback_result, fallback_result]
    
    return None

def inject_db_failure(mode: str):
    if should_fail("db_fail_write_api_success") and mode == "before_commit":
        logger.warning("Chaos: Simulating DB write fail AFTER API success")
        raise ChaosError("DB write failed after API success (Injected)")

    if should_fail("db_fail_commit_after_write") and mode == "after_write":
        logger.warning("Chaos: Simulating commit failure after write")
        raise ChaosError("DB commit failed after successful write (Injected)")
        
    if should_fail("db_fail_response_after_commit") and mode == "after_commit":
        logger.warning("Chaos: Simulating dropped response after DB commit")
        raise ChaosError("DB committed but response dropped (Injected)")

    if should_fail("db_deadlock"):
        logger.warning("Chaos: Simulating DB Deadlock")
        from sqlalchemy.exc import OperationalError
        raise OperationalError("SELECT FOR UPDATE deadlock", None, None)

def inject_redis_failure(mode: str):
    return should_fail("redis_failure_mode") or False

def inject_celery_failure(mode: str):
    return should_fail("celery_failure_mode") == mode
