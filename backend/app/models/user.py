from sqlalchemy import Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base

class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)  # Firebase UID
    phone_number: Mapped[str] = mapped_column(String(32), unique=True, index=True)
    role: Mapped[str] = mapped_column(String(16), default="CUSTOMER")  # CUSTOMER, BARBER, ADMIN
    risk_score: Mapped[float] = mapped_column(Float, nullable=False, default=0.0)
    no_show_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    cancellation_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at_unix: Mapped[int] = mapped_column(Integer, nullable=False)
