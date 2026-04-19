"""Retention, onboarding, disputes, reviews, abuse signals for controlled marketplace."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.marketplace import SalonBooking
    from app.models.vendor import Vendor


class CustomerRetentionProfile(Base):
    __tablename__ = "customer_retention_profiles"

    user_id: Mapped[str] = mapped_column(String(64), primary_key=True)
    updated_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    favorite_vendor_id: Mapped[str | None] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=True)
    preferences_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    loyalty_points: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    wallet_paise: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_booking_snapshot_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class VendorOnboardingState(Base):
    __tablename__ = "vendor_onboarding_states"

    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), primary_key=True)
    created_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    checklist_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    bookable_confirmed_at_unix: Mapped[int | None] = mapped_column(Integer, nullable=True)

    vendor: Mapped["Vendor"] = relationship("Vendor", back_populates="onboarding_state")


class Dispute(Base):
    __tablename__ = "disputes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    updated_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    salon_booking_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("salon_bookings.id"), nullable=False, index=True
    )
    opened_by: Mapped[str] = mapped_column(String(24), nullable=False)
    status: Mapped[str] = mapped_column(String(24), nullable=False, default="open")
    summary: Mapped[str | None] = mapped_column(Text, nullable=True)
    resolution_notes: Mapped[str | None] = mapped_column(Text, nullable=True)

    salon_booking: Mapped["SalonBooking"] = relationship("SalonBooking", back_populates="disputes")


class VendorReview(Base):
    __tablename__ = "vendor_reviews"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    salon_booking_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("salon_bookings.id"), nullable=False, unique=True, index=True
    )
    user_id: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    vendor_id: Mapped[str] = mapped_column(String(36), ForeignKey("vendors.id"), nullable=False, index=True)
    stars: Mapped[int] = mapped_column(Integer, nullable=False)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    weight: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    flags_json: Mapped[str | None] = mapped_column(Text, nullable=True)


class AbuseSignal(Base):
    __tablename__ = "abuse_signals"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
    signal_type: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    user_id: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    vendor_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    salon_booking_id: Mapped[str | None] = mapped_column(String(36), nullable=True)
    meta_json: Mapped[str | None] = mapped_column(Text, nullable=True)
