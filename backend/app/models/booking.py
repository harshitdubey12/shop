from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.vendor import Vendor


class Booking(Base):
    __tablename__ = "bookings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False)

    base_price_inr: Mapped[str] = mapped_column(String(24), nullable=False)
    platform_fee_inr: Mapped[str] = mapped_column(String(24), nullable=False)
    total_amount_inr: Mapped[str] = mapped_column(String(24), nullable=False)
    vendor_payout_inr: Mapped[str] = mapped_column(String(24), nullable=False)

    base_price_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    platform_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    total_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_payout_paise: Mapped[int] = mapped_column(Integer, nullable=False)

    # Financial validation fields (Phase 4)
    payment_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_transferred_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_refunded_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    remaining_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0) # Phase 11

    # Operation Locks & Safety (Phase 2, 4)
    financial_operation_lock: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)
    financial_lock_acquired_at: Mapped[int | None] = mapped_column(Integer, nullable=True) # Phase 2
    repair_in_progress: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)

    # Circuit Breaker & Debounce (Phase 3, 4)
    repair_attempt_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_repair_at: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_repair_triggered_at: Mapped[int | None] = mapped_column(Integer, nullable=True) # Phase 4

    razorpay_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    razorpay_transfer_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    
    # States: PAYMENT_CREATED, PAYMENT_CAPTURED, TRANSFER_INITIATED, TRANSFER_COMPLETED, TRANSFER_FAILED, 
    #         REFUND_INITIATED, REFUNDED, REFUND_FAILED, PARTIALLY_REFUNDED, CANCELLED_DUE_TO_CONFLICT,
    #         FINALIZED, FINANCIAL_LOCKED
    status: Mapped[str] = mapped_column(String(32), nullable=False, default="PAYMENT_CREATED")

    # Integrity: valid, mismatch_detected, pending_verification
    integrity_status: Mapped[str] = mapped_column(String(32), nullable=False, default="pending_verification", index=True)
    severity_level: Mapped[str | None] = mapped_column(String(16), nullable=True) # LOW, HIGH, CRITICAL
    repair_attempted: Mapped[bool] = mapped_column(Integer, nullable=False, default=0)
    repair_log: Mapped[str | None] = mapped_column(Text, nullable=True)
    manual_review_required: Mapped[bool] = mapped_column(Integer, nullable=False, default=0) # SQLite uses Integer for Bool

    transfer_error: Mapped[str | None] = mapped_column(Text, nullable=True)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="bookings")
