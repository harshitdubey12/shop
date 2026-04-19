from decimal import Decimal

from pydantic import BaseModel, Field, field_validator


class CreateRouteOrderIn(BaseModel):
    """Customer pays total = vendor (base) + fixed platform commission."""

    razorpay_account_id: str = Field(..., min_length=3, description="Linked account id, e.g. acc_xxx")
    vendor_amount_paise: int = Field(
        ...,
        ge=100,
        description="Vendor share in paise; must meet Razorpay Route minimum transfer (100 paise).",
    )
    receipt: str | None = Field(None, max_length=40)
    notes: dict[str, str] | None = Field(
        default=None,
        description="Optional order notes (max 15 keys per Razorpay limits).",
    )

    @field_validator("razorpay_account_id")
    @classmethod
    def account_must_look_linked(cls, v: str) -> str:
        s = v.strip()
        if not s.startswith("acc_"):
            raise ValueError("razorpay_account_id should be a linked account id (acc_...)")
        return s


class CreateRouteOrderOut(BaseModel):
    order_id: str
    amount_paise: int
    currency: str
    key_id: str
    vendor_amount_paise: int
    platform_commission_paise: int
    transfers: list[dict] | None = None


class CaptureRoutePaymentIn(BaseModel):
    """
    Razorpay does not accept `transfers` on the capture call itself.
    This endpoint captures an authorized payment (if needed) then posts Route transfers
    in the same request cycle so the vendor is funded automatically with no manual payout queue.
    """

    payment_id: str = Field(..., min_length=4)
    razorpay_account_id: str = Field(..., min_length=3)
    vendor_amount_paise: int = Field(..., ge=100)

    @field_validator("razorpay_account_id")
    @classmethod
    def account_must_look_linked(cls, v: str) -> str:
        s = v.strip()
        if not s.startswith("acc_"):
            raise ValueError("razorpay_account_id should be a linked account id (acc_...)")
        return s


class CaptureRoutePaymentOut(BaseModel):
    payment_id: str
    payment_status: str
    captured: dict | None = None
    transfers: dict


class QuoteIn(BaseModel):
    """Helper for clients that store vendor price in rupees."""

    base_price_inr: Decimal = Field(..., gt=Decimal("0"))


class QuoteOut(BaseModel):
    base_price_inr: Decimal
    platform_commission_inr: Decimal
    total_inr: Decimal
    vendor_amount_paise: int
    platform_commission_paise: int
    total_amount_paise: int


# Trust Profile Schemas
class TrustProfileOut(BaseModel):
    vendor_id: str
    name: str
    rating: float
    punctuality_score: float
    completion_rate: float
    response_time_ms_avg: int
    cancellation_rate: float
    no_show_rate: float
    is_verified: bool
    badges: list[str]


# Booking Schemas
class BookingPreviewIn(BaseModel):
    vendor_id: str
    service_id: str
    slot_start_unix: int
    user_id: str | None = None


class BookingPreviewOut(BaseModel):
    service_price_paise: int
    platform_fee_paise: int
    tax_paise: int
    total_amount_paise: int
    cancellation_policy: str = "Free cancellation up to 2 hours before the appointment."


class BookingCreateIn(BaseModel):
    vendor_id: str
    service_id: str
    slot_start_unix: int
    expected_price_paise: int


class BookingOut(BaseModel):
    id: str
    lifecycle_status: str
    service_price_paise: int
    platform_fee_paise: int
    tax_paise: int
    total_amount_paise: int


class BookingStatusUpdateIn(BaseModel):
    lifecycle_status: str  # confirmed, delayed, completed, cancelled, no_show
    reason: str | None = None


# Review Schemas
class ReviewCreateIn(BaseModel):
    stars: int
    body: str | None = None

class ReviewOut(BaseModel):
    id: str
    stars: int
    body: str | None
    is_verified: bool = True
