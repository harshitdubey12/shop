from __future__ import annotations

from dataclasses import dataclass
from decimal import ROUND_HALF_UP, Decimal


@dataclass(frozen=True)
class RouteSplitAmounts:
    """All amounts in paise (INR smallest unit)."""

    vendor_amount_paise: int
    platform_commission_paise: int
    total_amount_paise: int


def rupees_to_paise(rupees: Decimal) -> int:
    q = (rupees * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    return int(q)


def compute_split_from_vendor_rupees(
    base_price_inr: Decimal,
    platform_commission_paise: int,
) -> RouteSplitAmounts:
    """
    base_price = vendor price (INR)
    platform fee = platform_commission_paise / 100 INR
    total = vendor paise + commission paise
    """
    vendor_paise = rupees_to_paise(base_price_inr)
    total = vendor_paise + platform_commission_paise
    return RouteSplitAmounts(
        vendor_amount_paise=vendor_paise,
        platform_commission_paise=platform_commission_paise,
        total_amount_paise=total,
    )


def compute_split_from_vendor_paise(
    vendor_amount_paise: int,
    platform_commission_paise: int,
) -> RouteSplitAmounts:
    total = vendor_amount_paise + platform_commission_paise
    return RouteSplitAmounts(
        vendor_amount_paise=vendor_amount_paise,
        platform_commission_paise=platform_commission_paise,
        total_amount_paise=total,
    )


def assert_valid_route_vendor_amount(vendor_amount_paise: int, *, min_vendor_transfer_paise: int) -> None:
    """
    Razorpay Route transfers from payments require each transfer amount >= 100 paise.
    We enforce the same minimum for order-embedded transfers to keep one rule set.
    """
    if vendor_amount_paise < min_vendor_transfer_paise:
        raise ValueError(
            f"vendor_amount_paise must be >= {min_vendor_transfer_paise} "
            f"(Razorpay minimum transfer for INR Route)"
        )
