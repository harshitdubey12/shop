import os

# Settings use lru_cache; ensure env exists before any app.config import in tests.
os.environ.setdefault("RAZORPAY_KEY_ID", "rzp_test_dummy")
os.environ.setdefault("RAZORPAY_KEY_SECRET", "dummy_secret")
os.environ.setdefault("RAZORPAY_WEBHOOK_SECRET", "whsec_dummy")
os.environ.setdefault("ADMIN_API_KEY", "admin_dummy")
os.environ.setdefault("DATABASE_URL", "sqlite:///:memory:")

from app.config import get_settings

get_settings.cache_clear()
