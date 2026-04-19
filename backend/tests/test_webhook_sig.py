import hashlib
import hmac

from app.services.razorpay_service import verify_webhook_signature


def test_verify_webhook_signature_ok() -> None:
    body = b'{"event":"payment.captured"}'
    secret = "my_webhook_secret"
    sig = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    assert verify_webhook_signature(body, sig, secret) is True


def test_verify_webhook_signature_bad() -> None:
    body = b'{"event":"payment.captured"}'
    assert verify_webhook_signature(body, "deadbeef", "secret") is False
