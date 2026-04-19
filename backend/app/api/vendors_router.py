from __future__ import annotations

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services import vendor_service

router = APIRouter(prefix="/api/v1/vendors", tags=["vendors"])


class VendorApplicationIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    phone: str = Field(..., min_length=8, max_length=32)
    email: str = Field(..., min_length=3, max_length=255)
    bank_account_number: str | None = Field(None, max_length=64)
    ifsc_code: str | None = Field(None, max_length=32)


@router.post("/application", status_code=201)
def submit_vendor_application(body: VendorApplicationIn, db: Session = Depends(get_db)) -> dict:
    v = vendor_service.register_vendor(
        db,
        name=body.name,
        phone=body.phone,
        email=body.email,
        bank_account_number=body.bank_account_number,
        ifsc_code=body.ifsc_code,
    )
    return {"id": v.id, "verification_status": v.verification_status}

from app.schemas import TrustProfileOut
from fastapi import HTTPException

@router.get("/{id}/trust-profile", response_model=TrustProfileOut)
def get_vendor_trust_profile(id: str, db: Session = Depends(get_db)):
    # Mocking vendor lookup
    return TrustProfileOut(
        vendor_id=id,
        name="Trust Barbershop",
        rating=4.8,
        punctuality_score=95.5,
        completion_rate=98.0,
        response_time_ms_avg=300000,
        cancellation_rate=1.5,
        no_show_rate=0.5,
        is_verified=True,
        badges=["top_rated", "verified", "on_time"]
    )
