"""India marketplace: salon appointments, slot holds, history, waitlist, reminders."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import ForeignKey, Integer, String, Text, func, Index
from sqlalchemy.dialects.postgresql import ExcludeConstraint, TSRANGE
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.controlled_marketplace import Dispute
    from app.models.vendor import Vendor


class SlotHold(Base):
    __tablename__ = "slot_holds"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False, index=True)
    barber_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    slot_start_unix: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    slot_end_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    hold_token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    expires_at_unix: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="active")  # active|consumed|expired

    __table_args__ = (
        ExcludeConstraint(
            ("barber_id", "="),
            (func.tsrange(func.to_timestamp(slot_start_unix), func.to_timestamp(slot_end_unix)), "&&"),
            name="exclude_overlapping_holds",
            where=(status == 'active')
        ),
        Index("ix_slot_holds_vendor_slot", "vendor_id", "slot_start_unix"),
    )


class SlotHistory(Base):
    __tablename__ = "slot_history"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False, index=True)
    barber_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    slot_start_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    slot_end_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    event: Mapped[str] = mapped_column(String(48), nullable=False)
    entity_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class SalonBooking(Base):
    """
    Marketplace appointment (separate from Razorpay route ``bookings`` payment rows).
    Phase 1: customer pays platform fee online; service settled at shop.
    """

    __tablename__ = "salon_bookings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False)

    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False, index=True)
    barber_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    slot_start_unix: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    slot_end_unix: Mapped[int] = mapped_column(Integer, nullable=False)

    lifecycle_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="created"
    )  # created|pending_barber|confirmed|cancelled|completed|no_show

    payment_phase: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    payment_status: Mapped[str] = mapped_column(
        String(40), nullable=False, default="awaiting_platform_fee"
    )  # awaiting_platform_fee|platform_fee_paid|service_at_shop|deposit_paid|full_paid

    service_price_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    platform_fee_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    tax_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    total_amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    fee_paid_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    source: Mapped[str] = mapped_column(String(24), nullable=False, default="app")  # app|walk_in

    customer_phone_masked: Mapped[str | None] = mapped_column(String(32), nullable=True)
    customer_phone_hash: Mapped[str | None] = mapped_column(String(128), nullable=True, index=True)

    slot_hold_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("slot_holds.id"), nullable=True)
    razorpay_order_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    barber_decision: Mapped[str | None] = mapped_column(String(24), nullable=True)  # pending|accepted|rejected

    customer_arrival_confirmed_at_unix: Mapped[int | None] = mapped_column(Integer, nullable=True)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="salon_bookings")
    disputes: Mapped[list["Dispute"]] = relationship("Dispute", back_populates="salon_booking")

    __table_args__ = (
        ExcludeConstraint(
            ("barber_id", "="),
            (func.tsrange(func.to_timestamp(slot_start_unix), func.to_timestamp(slot_end_unix)), "&&"),
            name="exclude_overlapping_bookings",
            where=(lifecycle_status.in_(['confirmed', 'completed', 'created', 'pending_barber']))
        ),
        Index("ix_salon_bookings_vendor_slot", "vendor_id", "slot_start_unix"),
        Index("ix_salon_bookings_lifecycle", "lifecycle_status"),
    )


class WaitlistEntry(Base):
    __tablename__ = "waitlist_entries"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    slot_start_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    slot_end_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="waiting")  # waiting|offered|closed


class ReminderJob(Base):
    __tablename__ = "reminder_jobs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    salon_booking_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("salon_bookings.id"), nullable=False, index=True
    )
    channel: Mapped[str] = mapped_column(String(16), nullable=False)  # whatsapp|sms|push
    run_at_unix: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    status: Mapped[str] = mapped_column(String(16), nullable=False, default="pending")  # pending|sent|failed
    template: Mapped[str] = mapped_column(String(64), nullable=False, default="booking_reminder")
    retry_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    max_retries: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    next_attempt_unix: Mapped[int | None] = mapped_column(Integer, nullable=True, index=True)
    last_error: Mapped[str | None] = mapped_column(Text, nullable=True)


class IdempotencyKey(Base):
    __tablename__ = "idempotency_keys"

    key: Mapped[str] = mapped_column(String(128), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    request_path: Mapped[str] = mapped_column(String(255), nullable=False)
    response_body: Mapped[str | None] = mapped_column(Text, nullable=True)
    response_status: Mapped[int | None] = mapped_column(Integer, nullable=True)


class PaymentLedger(Base):
    """Append-only ledger for all financial movements."""
    __tablename__ = "payment_ledger"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    booking_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("salon_bookings.id"), nullable=True, index=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True, index=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    currency: Mapped[str] = mapped_column(String(3), nullable=False, default="INR")
    transaction_type: Mapped[str] = mapped_column(String(32), nullable=False)  # deposit, refund, platform_fee, payout
    razorpay_payment_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)

class FinancialActionLog(Base):
    __tablename__ = "financial_action_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    booking_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    action_type: Mapped[str] = mapped_column(String(32), nullable=False) # transfer | refund
    status: Mapped[str] = mapped_column(String(32), nullable=False) # INITIATED | CONFIRMED | FAILED
    external_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    idempotency_key: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    correlation_id: Mapped[str | None] = mapped_column(String(64), nullable=True) # Phase 7
    parent_action_id: Mapped[str | None] = mapped_column(String(64), nullable=True) # Phase 7
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
    updated_at: Mapped[int] = mapped_column(Integer, nullable=False)


class AdminActionLog(Base):
    __tablename__ = "admin_action_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    actor_id: Mapped[str] = mapped_column(String(64), nullable=False)
    role: Mapped[str] = mapped_column(String(32), nullable=False)
    action_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    target_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True)
    status: Mapped[str] = mapped_column(String(32), nullable=False) # success | failure
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, index=True)

class RefundLog(Base):
    __tablename__ = "refund_log"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    booking_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    payment_id: Mapped[str] = mapped_column(String(64), nullable=False)
    amount_paise: Mapped[int] = mapped_column(Integer, nullable=False)
    reason: Mapped[str] = mapped_column(String(64), nullable=False) # conflict_refund, manual_refund, dispute
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="completed") # initiated, completed, failed
    razorpay_refund_id: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True, index=True)
    idempotency_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False, index=True)
