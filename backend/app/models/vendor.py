from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import Boolean, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

if TYPE_CHECKING:
    from app.models.booking import Booking
    from app.models.controlled_marketplace import VendorOnboardingState
    from app.models.marketplace import SalonBooking


class Vendor(Base):
    __tablename__ = "vendors"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    created_at: Mapped[int] = mapped_column(Integer, nullable=False)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    phone: Mapped[str] = mapped_column(String(32), nullable=False)
    email: Mapped[str] = mapped_column(String(255), nullable=False)
    razorpay_account_id: Mapped[str | None] = mapped_column(String(64), nullable=True)
    bank_account_number: Mapped[str | None] = mapped_column(String(64), nullable=True)
    ifsc_code: Mapped[str | None] = mapped_column(String(32), nullable=True)
    verification_status: Mapped[str] = mapped_column(
        String(32), nullable=False, default="pending"
    )

    # Marketplace / trust (single source in SQL for backend-orchestrated flows)
    rating: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    cancellation_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    no_show_rate: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    punctuality_score: Mapped[float] = mapped_column(Float, nullable=False, default=5.0)
    response_time_ms_avg: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    completion_rate: Mapped[float] = mapped_column(Float, nullable=False, default=1.0)
    badges_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    availability_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    penalty_rank_score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    city_code: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)

    address_line: Mapped[str | None] = mapped_column(Text, nullable=True)
    hours_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    photo_urls_json: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_bookable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    last_active_unix: Mapped[int | None] = mapped_column(Integer, nullable=True)
    new_shop_boost_until_unix: Mapped[int | None] = mapped_column(Integer, nullable=True)
    listing_hidden_reason: Mapped[str | None] = mapped_column(String(255), nullable=True)

    bookings: Mapped[list["Booking"]] = relationship("Booking", back_populates="vendor")
    salon_bookings: Mapped[list["SalonBooking"]] = relationship("SalonBooking", back_populates="vendor")
    onboarding_state: Mapped["VendorOnboardingState | None"] = relationship(
        "VendorOnboardingState",
        back_populates="vendor",
        uselist=False,
    )
