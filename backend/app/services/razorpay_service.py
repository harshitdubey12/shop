"""
Razorpay Route HTTP client, webhook verification, and marketplace primitives.

Note: ``POST /v1/payments/:id/capture`` only accepts amount and currency.
Route splits after capture use ``POST /v1/payments/:id/transfers`` (same request cycle in code).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import logging
import uuid
from typing import Any

import httpx

from app.config import Settings

logger = logging.getLogger(__name__)


class RazorpayAPIError(Exception):
    def __init__(self, status_code: int, payload: dict[str, Any]) -> None:
        self.status_code = status_code
        self.payload = payload
        err = payload.get("error") if isinstance(payload, dict) else None
        desc = err.get("description") if isinstance(err, dict) else str(payload)
        super().__init__(desc or "Razorpay API error")


async def _request(
    settings: Settings,
    method: str,
    path: str,
    *,
    json_body: dict[str, Any] | None = None,
) -> dict[str, Any]:
    url = f"{settings.razorpay_base_url.rstrip('/')}{path}"
    headers: dict[str, str] = {}
    kwargs: dict[str, Any] = {
        "auth": (settings.razorpay_key_id, settings.razorpay_key_secret),
    }
    if json_body is not None:
        headers["Content-Type"] = "application/json"
        kwargs["json"] = json_body
    if headers:
        kwargs["headers"] = headers

    from app import failure_injection
    
    # 1. Simulate Timeout BEFORE making the request
    await failure_injection.inject_razorpay_failure("timeout")

    # Phase 9: Safety Kill Switch
    if settings.chaos_mode:
        logger.warning(f"CHAOS_MODE ACTIVE: Blocking external request to {method} {url}")
        # Return a dummy payload so test logic doesn't crash on dict lookups
        data = {
            "id": f"dummy_{uuid.uuid4()}", 
            "status": "captured",
            "amount": 10500,
            "items": [{"id": f"trf_{uuid.uuid4()}", "amount": 10500}]
        }
        r_status = 200
    else:
        # Make the actual API request
        async with httpx.AsyncClient(timeout=45.0) as client:
            r = await client.request(method, url, **kwargs)
        r_status = r.status_code
        try:
            data = r.json()
        except Exception:
            data = {"raw": r.text}
    if r_status >= 400:
        logger.warning("Razorpay API error %s %s: %s", method, path, data)
        raise RazorpayAPIError(r_status, data if isinstance(data, dict) else {"error": data})
    if not isinstance(data, dict):
        raise RazorpayAPIError(r_status, {"error": {"description": "non-object JSON response"}})
        
    # 2. Simulate Success but Connection Drop (API succeeded, but we act like it failed)
    if failure_injection.should_fail("razorpay_success_no_response"):
        logger.warning("Chaos: Simulating API success but connection drop before response")
        raise failure_injection.ChaosError("Connection dropped after API success (Injected)")

    # 3. Simulate Duplicate Response
    if failure_injection.should_fail("razorpay_duplicate_response"):
        logger.warning("Chaos: Simulating duplicate API response")
        # In this chaos mode, we pretend we got an array of duplicate results instead of one, 
        # or we just return the same result. If the caller expects a dict, we can't return a list 
        # unless it's a specific endpoint. Instead, we can execute the request AGAIN to simulate 
        # a duplicate execution on the Razorpay side!
        async with httpx.AsyncClient(timeout=45.0) as client2:
            await client2.request(method, url, **kwargs)
            
    return data


def verify_webhook_signature(body: bytes, signature_header: str | None, secret: str) -> bool:
    if not signature_header:
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(digest, signature_header)


def phone_to_razorpay_int(phone: str) -> int:
    digits = "".join(ch for ch in phone if ch.isdigit())
    if len(digits) < 10:
        raise ValueError("phone must contain at least 10 digits")
    return int(digits[-10:])


async def create_vendor_razorpay_account(settings: Settings, payload: dict[str, Any]) -> dict[str, Any]:
    """
    Create a Route linked account: ``POST /v2/accounts``.
    Caller must supply a Razorpay-valid payload (profile, legal_info, etc.).
    """
    return await _request(settings, "POST", "/v2/accounts", json_body=payload)


def build_minimal_route_account_payload(
    *,
    email: str,
    phone: str,
    legal_business_name: str,
    business_type: str = "individual",
    reference_id: str | None = None,
    profile: dict[str, Any],
    legal_info: dict[str, Any],
    contact_name: str | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "email": email.strip(),
        "phone": phone_to_razorpay_int(phone),
        "type": "route",
        "legal_business_name": legal_business_name.strip(),
        "business_type": business_type,
        "profile": profile,
        "legal_info": legal_info,
    }
    if reference_id:
        body["reference_id"] = reference_id[:512]
    if contact_name:
        body["contact_name"] = contact_name.strip()
    return body


async def create_order_plain(
    settings: Settings,
    *,
    amount_paise: int,
    currency: str,
    receipt: str | None,
    notes: dict[str, str] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "amount": amount_paise,
        "currency": currency,
        "payment_capture": 1,
        "partial_payment": 0,
    }
    if receipt:
        body["receipt"] = receipt[:40]
    if notes:
        body["notes"] = notes
    return await _request(settings, "POST", "/v1/orders", json_body=body)


async def create_order_with_transfers(
    settings: Settings,
    *,
    amount_paise: int,
    currency: str,
    receipt: str | None,
    transfers: list[dict[str, Any]],
    notes: dict[str, str] | None = None,
) -> dict[str, Any]:
    body: dict[str, Any] = {
        "amount": amount_paise,
        "currency": currency,
        "payment_capture": 1,
        "partial_payment": 0,
        "transfers": transfers,
    }
    if receipt:
        body["receipt"] = receipt[:40]
    if notes:
        body["notes"] = notes
    return await _request(settings, "POST", "/v1/orders", json_body=body)


async def fetch_payment(settings: Settings, payment_id: str) -> dict[str, Any]:
    return await _request(settings, "GET", f"/v1/payments/{payment_id}", json_body=None)


async def fetch_order_payments(settings: Settings, order_id: str) -> dict[str, Any]:
    return await _request(settings, "GET", f"/v1/orders/{order_id}/payments", json_body=None)


async def capture_payment(
    settings: Settings,
    payment_id: str,
    *,
    amount_paise: int,
    currency: str,
) -> dict[str, Any]:
    body = {"amount": amount_paise, "currency": currency}
    return await _request(settings, "POST", f"/v1/payments/{payment_id}/capture", json_body=body)

async def refund_payment(
    settings: Settings,
    payment_id: str,
    amount_paise: int,
) -> dict[str, Any]:
    body = {"amount": amount_paise}
    return await _request(settings, "POST", f"/v1/payments/{payment_id}/refund", json_body=body)


async def create_transfers_for_payment(
    settings: Settings,
    payment_id: str,
    *,
    transfers: list[dict[str, Any]],
) -> dict[str, Any]:
    return await _request(
        settings,
        "POST",
        f"/v1/payments/{payment_id}/transfers",
        json_body={"transfers": transfers},
    )


async def capture_then_route_transfers(
    settings: Settings,
    *,
    payment_id: str,
    total_amount_paise: int,
    vendor_account_id: str,
    vendor_payout_paise: int,
    currency: str = "INR",
) -> tuple[dict[str, Any] | None, dict[str, Any]]:
    """
    Implements marketplace split at payment time without manual payouts:
    capture (if still authorized) then Route transfer to linked account.
    """
    pay = await fetch_payment(settings, payment_id)
    status = str(pay.get("status", ""))
    amount = int(pay.get("amount", 0))
    cur = str(pay.get("currency", currency))

    if amount != total_amount_paise:
        raise RazorpayAPIError(
            400,
            {
                "error": {
                    "description": f"payment amount {amount} != expected total {total_amount_paise}",
                }
            },
        )

    captured: dict[str, Any] | None = None
    if status == "authorized":
        captured = await capture_payment(
            settings, payment_id, amount_paise=total_amount_paise, currency=cur
        )
    elif status != "captured":
        raise RazorpayAPIError(
            409,
            {"error": {"description": f"payment not capturable from status {status}"}},
        )

    transfers_body = [
        {
            "account": vendor_account_id,
            "amount": vendor_payout_paise,
            "currency": cur,
        }
    ]
    tr = await create_transfers_for_payment(settings, payment_id, transfers=transfers_body)
    return captured, tr


async def fetch_payment_transfers(settings: Settings, payment_id: str) -> dict[str, Any]:
    return await _request(settings, "GET", f"/v1/payments/{payment_id}/transfers", json_body=None)


async def fetch_payment_refunds(settings: Settings, payment_id: str) -> dict[str, Any]:
    return await _request(settings, "GET", f"/v1/payments/{payment_id}/refunds", json_body=None)


async def verify_payment_integrity(
    settings: Settings,
    *,
    payment_id: str,
    expected_amount_paise: int,
    expected_transfer_account: str | None = None,
    expected_transfer_amount: int | None = None,
) -> dict[str, Any]:
    """
    Cross-checks local DB state with Razorpay source of truth.
    Returns { "valid": bool, "mismatches": list[str], "razorpay_state": dict }
    """
    mismatches = []
    try:
        pay = await fetch_payment(settings, payment_id)
    except RazorpayAPIError as e:
        return {"valid": False, "mismatches": [f"Payment not found or API error: {e}"], "razorpay_state": {}}

    # 1. Amount Check
    actual_amount = int(pay.get("amount", 0))
    if actual_amount != expected_amount_paise:
        mismatches.append(f"Amount mismatch: local={expected_amount_paise} rzp={actual_amount}")

    # 2. Capture Check
    status = pay.get("status")
    if status != "captured":
        mismatches.append(f"Status mismatch: expected captured, got {status}")

    # 3. Transfer Check (if applicable)
    if expected_transfer_account and expected_transfer_amount:
        transfers_resp = await fetch_payment_transfers(settings, payment_id)
        items = transfers_resp.get("items", [])
        found_transfer = False
        for tr in items:
            if tr.get("account") == expected_transfer_account:
                found_transfer = True
                tr_amt = int(tr.get("amount", 0))
                if tr_amt != expected_transfer_amount:
                    mismatches.append(f"Transfer amount mismatch: local={expected_transfer_amount} rzp={tr_amt}")
                break
        
        if not found_transfer:
            mismatches.append(f"Transfer to {expected_transfer_account} not found in Razorpay")

    return {
        "valid": len(mismatches) == 0,
        "mismatches": mismatches,
        "razorpay_state": {
            "status": status,
            "amount": actual_amount,
            "payment_id": payment_id
        }
    }


def load_json_setting(raw: str | None, label: str) -> dict[str, Any] | None:
    if not raw or not raw.strip():
        return None
    try:
        out = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"{label} is not valid JSON") from e
    if not isinstance(out, dict):
        raise ValueError(f"{label} must be a JSON object")
    return out
