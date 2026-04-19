from functools import lru_cache

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    razorpay_key_id: str = Field(..., alias="RAZORPAY_KEY_ID")
    razorpay_key_secret: str = Field(..., alias="RAZORPAY_KEY_SECRET")

    razorpay_route_enabled: bool = Field(True, alias="RAZORPAY_ROUTE_ENABLED")
    platform_commission_paise: int = Field(500, alias="PLATFORM_COMMISSION_PAISE", ge=1, le=1_000_000)

    route_internal_api_key: str | None = Field(None, alias="ROUTE_INTERNAL_API_KEY")
    razorpay_base_url: str = Field("https://api.razorpay.com", alias="RAZORPAY_BASE_URL")

    database_url: str = Field("sqlite:///./data/app.db", alias="DATABASE_URL")

    razorpay_webhook_secret: str = Field(..., alias="RAZORPAY_WEBHOOK_SECRET")
    # ADMIN_API_KEYS_JSON format: {"key1": {"actor_id": "harshit", "role": "admin"}, "key2": {"actor_id": "ops1", "role": "operator"}}
    admin_api_keys_json: str = Field('{"secret_admin_key": {"actor_id": "harshit", "role": "admin"}}', alias="ADMIN_API_KEYS_JSON")
    debug_mode: bool = Field(False, alias="DEBUG")
    
    # Chaos Framework settings
    chaos_mode: bool = Field(False, alias="CHAOS_MODE")
    chaos_seed: int = Field(12345, alias="CHAOS_SEED")

    # Optional JSON defaults for POST /v2/accounts when admin omits body.profile / legal_info.
    default_route_account_profile_json: str | None = Field(None, alias="DEFAULT_ROUTE_ACCOUNT_PROFILE_JSON")
    default_route_account_legal_json: str | None = Field(None, alias="DEFAULT_ROUTE_ACCOUNT_LEGAL_JSON")

    # Marketplace fee policy (paise). Phase 1: customer pays total_online only; service at shop.
    first_booking_fee_waived: bool = Field(True, alias="FIRST_BOOKING_FEE_WAIVED")
    platform_fee_min_paise: int = Field(500, alias="PLATFORM_FEE_MIN_PAISE", ge=0)
    platform_fee_max_paise: int = Field(1000, alias="PLATFORM_FEE_MAX_PAISE", ge=0)
    peak_fee_enabled: bool = Field(True, alias="PEAK_FEE_ENABLED")
    peak_fee_multiplier: float = Field(1.5, alias="PEAK_FEE_MULTIPLIER", ge=1.0)
    platform_fee_max_peak_paise: int = Field(1500, alias="PLATFORM_FEE_MAX_PEAK_PAISE", ge=0)
    deposit_enabled: bool = Field(False, alias="DEPOSIT_ENABLED")
    deposit_suggested_paise: int = Field(2000, alias="DEPOSIT_SUGGESTED_PAISE", ge=0)
    hold_ttl_seconds: int = Field(120, alias="HOLD_TTL_SECONDS", ge=60, le=3600)
    auto_confirm_salon_booking: bool = Field(True, alias="AUTO_CONFIRM_SALON_BOOKING")
    cancel_cutoff_seconds: int = Field(7200, alias="CANCEL_CUTOFF_SECONDS", ge=0)
    loyalty_points_per_completed_booking: int = Field(10, alias="LOYALTY_POINTS_PER_BOOKING", ge=0)
    wallet_credit_per_100_points_paise: int = Field(50, alias="WALLET_CREDIT_PER_100_POINTS_PAISE", ge=0)

    # Anomaly Detection Thresholds
    anomaly_refund_threshold_per_hour: int = Field(10, alias="ANOMALY_REFUND_THRESHOLD_PER_HOUR", ge=1)
    anomaly_failed_transfer_threshold_per_hour: int = Field(5, alias="ANOMALY_FAILED_TRANSFER_THRESHOLD_PER_HOUR", ge=1)
    anomaly_cancellation_threshold_per_hour: int = Field(20, alias="ANOMALY_CANCELLATION_THRESHOLD_PER_HOUR", ge=1)

    @field_validator("razorpay_key_id", "razorpay_key_secret", "razorpay_webhook_secret")
    @classmethod
    def strip_secrets(cls, v: str) -> str:
        s = v.strip()
        if not s:
            raise ValueError("must not be empty")
        return s


@lru_cache
def get_settings() -> Settings:
    return Settings()
