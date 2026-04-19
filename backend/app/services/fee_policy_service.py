"""
Flexible platform fee rules for India marketplace (visible before checkout).

Rules (configurable via Settings):
- First completed booking on the platform for this user → platform fee 0 (still show service price).
- Normal window → random fee between min and max paise (deterministic from slot hash for stability).
- Peak slot → multiply base fee by peak_multiplier (capped at max_peak_fee_paise).
- Optional deposit for risky slots (Phase 2): returned as suggested_deposit_paise only.
"""
from __future__ import annotations

import hashlib
from dataclasses import dataclass
from decimal import Decimal

from app.config import Settings


@dataclass(frozen=True)
class FeePreview:
    service_price_paise: int
    platform_fee_paise: int
    total_online_paise_phase1: int  # customer pays online in phase 1
    is_first_booking_free: bool
    is_peak: bool
    suggested_deposit_paise: int
    breakdown: dict
    fee_explanation: str
    value_proposition_line: str


def _slot_peak(slot_start_unix: int, settings: Settings) -> bool:
    """Heuristic peak: weekend evening IST-ish using UTC epoch (tune per city later)."""
    if not settings.peak_fee_enabled:
        return False
    # (weekday 4=Fri .. 6=Sun) simplified using day of week from unix
    from datetime import datetime, timezone

    dt = datetime.fromtimestamp(slot_start_unix, tz=timezone.utc)
    wd = dt.weekday()
    hour = dt.hour
    # Fri/Sat/Sun evening UTC+5:30 approximated: widen band in UTC
    if wd in (4, 5, 6) and 12 <= hour <= 20:
        return True
    if wd in (5, 6) and 8 <= hour <= 11:
        return True
    return False


def _stable_fee_in_range(slot_start_unix: int, user_id: str, lo: int, hi: int) -> int:
    if hi <= lo:
        return lo
    h = hashlib.sha256(f"{slot_start_unix}|{user_id}".encode()).hexdigest()
    n = int(h[:8], 16)
    return lo + (n % (hi - lo + 1))


def count_user_prior_paid_or_completed_bookings(db, user_id: str) -> int:
    """First booking waiver: user has no completed visit and no platform fee paid yet."""
    from sqlalchemy import func, or_, select

    from app.models.marketplace import SalonBooking

    q = select(func.count()).select_from(SalonBooking).where(
        SalonBooking.user_id == user_id,
        or_(
            SalonBooking.lifecycle_status == "completed",
            SalonBooking.fee_paid_paise > 0,
        ),
    )
    return int(db.scalar(q) or 0)


def preview_platform_fee(
    settings: Settings,
    db,
    *,
    user_id: str,
    service_price_paise: int,
    slot_start_unix: int,
    risky_slot: bool = False,
) -> FeePreview:
    if service_price_paise < 0:
        raise ValueError("service_price_paise invalid")

    prior = count_user_prior_paid_or_completed_bookings(db, user_id)
    first_free = prior == 0 and settings.first_booking_fee_waived

    base_fee = _stable_fee_in_range(
        slot_start_unix,
        user_id,
        settings.platform_fee_min_paise,
        settings.platform_fee_max_paise,
    )
    peak = _slot_peak(slot_start_unix, settings)
    if peak and not first_free:
        base_fee = min(
            int(base_fee * settings.peak_fee_multiplier),
            settings.platform_fee_max_peak_paise,
        )

    if first_free:
        platform = 0
    else:
        platform = base_fee

    deposit = settings.deposit_suggested_paise if risky_slot and settings.deposit_enabled else 0

    online_phase1 = platform  # customer pays only platform fee online in phase 1

    value_line = (
        "Convenience plus guaranteed slot plus reminders. Small platform fee keeps the shop fair for everyone."
    )
    if first_free:
        fee_expl = "Your first confirmed booking has no platform fee online. You only prepay the slot reservation flow at the shop price shown."
    elif peak:
        fee_expl = (
            "Peak time slot: slightly higher platform fee covers higher no show risk and demand balancing. "
            "You still see the exact rupee amount before you pay."
        )
    else:
        fee_expl = (
            "Normal window: platform fee stays between configured min and max in paise for transparency. "
            "It funds reminders, dispute logs, and slot protection."
        )
    if deposit:
        fee_expl += " Optional deposit model is suggested for this slot type; settle details at checkout."

    return FeePreview(
        service_price_paise=service_price_paise,
        platform_fee_paise=platform,
        total_online_paise_phase1=online_phase1,
        is_first_booking_free=first_free,
        is_peak=peak,
        suggested_deposit_paise=deposit,
        breakdown={
            "service_price_inr": str(Decimal(service_price_paise) / 100),
            "platform_fee_inr": str(Decimal(platform) / 100),
            "total_pay_online_phase1_inr": str(Decimal(online_phase1) / 100),
            "pay_at_shop_inr": str(Decimal(service_price_paise) / 100),
            "first_booking_waived": first_free,
            "peak_window": peak,
        },
        fee_explanation=fee_expl,
        value_proposition_line=value_line,
    )
