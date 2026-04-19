from __future__ import annotations

from decimal import Decimal
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, status

from app.config import Settings, get_settings
from app.deps import optional_internal_key, require_route_enabled
from app.money import compute_split_from_vendor_paise, compute_split_from_vendor_rupees
from app.services import razorpay_service
from app.schemas import (
    CaptureRoutePaymentIn,
    CaptureRoutePaymentOut,
    CreateRouteOrderIn,
    CreateRouteOrderOut,
    QuoteIn,
    QuoteOut,
)

router = APIRouter(prefix="/route", tags=["razorpay-route"])


@router.get("/health")
async def health(settings: Annotated[Settings, Depends(get_settings)]) -> dict[str, str | bool]:
    return {
        "status": "ok",
        "razorpay_route_enabled": settings.razorpay_route_enabled,
        "platform_commission_paise": settings.platform_commission_paise,
    }


@router.post("/quote", response_model=QuoteOut)
async def quote_split(
    body: QuoteIn,
    settings: Annotated[Settings, Depends(get_settings)],
) -> QuoteOut:
    """Pure pricing: total = base + fixed commission; no Razorpay call."""
    split = compute_split_from_vendor_rupees(body.base_price_inr, settings.platform_commission_paise)
    comm_inr = Decimal(settings.platform_commission_paise) / Decimal(100)
    total_inr = body.base_price_inr + comm_inr
    return QuoteOut(
        base_price_inr=body.base_price_inr,
        platform_commission_inr=comm_inr,
        total_inr=total_inr,
        vendor_amount_paise=split.vendor_amount_paise,
        platform_commission_paise=split.platform_commission_paise,
        total_amount_paise=split.total_amount_paise,
    )


@router.post("/orders", response_model=CreateRouteOrderOut, dependencies=[Depends(optional_internal_key)])
async def create_route_order(
    body: CreateRouteOrderIn,
    settings: Annotated[Settings, Depends(require_route_enabled)],
) -> CreateRouteOrderOut:
    """
    Create a Razorpay Order with Route transfers embedded.
    Customer is charged `vendor_amount_paise + platform_commission`; vendor receives `vendor_amount_paise`
    instantly as part of settlement routing (no separate payout file on your side).
    """
    split = compute_split_from_vendor_paise(body.vendor_amount_paise, settings.platform_commission_paise)
    transfers = [
        {
            "account": body.razorpay_account_id,
            "amount": split.vendor_amount_paise,
            "currency": "INR",
        }
    ]
    try:
        raw = await razorpay_service.create_order_with_transfers(
            settings,
            amount_paise=split.total_amount_paise,
            currency="INR",
            receipt=body.receipt,
            transfers=transfers,
            notes=body.notes,
        )
    except razorpay_service.RazorpayAPIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    order_id = raw.get("id")
    if not isinstance(order_id, str):
        raise HTTPException(status_code=502, detail="Unexpected Razorpay order response")

    tr = raw.get("transfers")
    transfers_out = tr if isinstance(tr, list) else None

    return CreateRouteOrderOut(
        order_id=order_id,
        amount_paise=int(raw.get("amount", split.total_amount_paise)),
        currency=str(raw.get("currency", "INR")),
        key_id=settings.razorpay_key_id,
        vendor_amount_paise=split.vendor_amount_paise,
        platform_commission_paise=split.platform_commission_paise,
        transfers=transfers_out,
    )


@router.post(
    "/payments/capture-and-transfer",
    response_model=CaptureRoutePaymentOut,
    dependencies=[Depends(optional_internal_key)],
)
async def capture_and_route_transfers(
    body: CaptureRoutePaymentIn,
    settings: Annotated[Settings, Depends(require_route_enabled)],
) -> CaptureRoutePaymentOut:
    """
    For card flows that stay in `authorized` until capture:
    1) Capture the full order amount on the payment.
    2) POST Route transfers so the linked account receives vendor share immediately.

    Note: Razorpay's capture API does not accept `transfers`; transfers are applied via
    `POST /v1/payments/:id/transfers` right after capture in this single handler.
    """
    split = compute_split_from_vendor_paise(body.vendor_amount_paise, settings.platform_commission_paise)
    try:
        pay = await razorpay_service.fetch_payment(settings, body.payment_id)
    except razorpay_service.RazorpayAPIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    pay_status = str(pay.get("status", ""))
    amount = int(pay.get("amount", 0))
    currency = str(pay.get("currency", "INR"))

    if amount != split.total_amount_paise:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Payment amount {amount} paise does not match expected total "
                f"{split.total_amount_paise} paise (vendor {split.vendor_amount_paise} + "
                f"platform {split.platform_commission_paise})."
            ),
        )

    captured: dict | None = None
    if pay_status == "authorized":
        try:
            captured = await razorpay_service.capture_payment(
                settings,
                body.payment_id,
                amount_paise=split.total_amount_paise,
                currency=currency,
            )
        except razorpay_service.RazorpayAPIError as e:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e
    elif pay_status == "captured":
        captured = None
    else:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Payment status {pay_status!r} cannot be routed (expected authorized or captured).",
        )

    transfers_body = [
        {
            "account": body.razorpay_account_id,
            "amount": split.vendor_amount_paise,
            "currency": "INR",
        }
    ]
    try:
        tr = await razorpay_service.create_transfers_for_payment(
            settings,
            body.payment_id,
            transfers=transfers_body,
        )
    except razorpay_service.RazorpayAPIError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e)) from e

    return CaptureRoutePaymentOut(
        payment_id=body.payment_id,
        payment_status="captured",
        captured=captured,
        transfers=tr,
    )
