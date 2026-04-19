from decimal import Decimal

import pytest

from app.money import (
    assert_valid_route_vendor_amount,
    compute_split_from_vendor_paise,
    compute_split_from_vendor_rupees,
)


def test_split_from_rupees() -> None:
    s = compute_split_from_vendor_rupees(Decimal("100.00"), 500)
    assert s.vendor_amount_paise == 10000
    assert s.platform_commission_paise == 500
    assert s.total_amount_paise == 10500


def test_split_from_paise() -> None:
    s = compute_split_from_vendor_paise(10000, 500)
    assert s.total_amount_paise == 10500


def test_min_transfer_validation() -> None:
    assert_valid_route_vendor_amount(100, min_vendor_transfer_paise=100)
    with pytest.raises(ValueError):
        assert_valid_route_vendor_amount(99, min_vendor_transfer_paise=100)
