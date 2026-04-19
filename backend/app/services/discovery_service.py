"""Fair ranking: reliability, punctuality, response, rating, locality, new shop rotation."""
from __future__ import annotations

import time
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.vendor import Vendor

from app.services.supply_quality_service import is_vendor_listable


def _score_vendor(v: Vendor, *, now: int) -> float:
    rating = float(v.rating or 0.0)
    punct = float(v.punctuality_score or 0.0)
    completion = float(v.completion_rate or 0.0)
    cancel_penalty = float(v.cancellation_rate or 0.0) * 2.0
    noshow_penalty = float(v.no_show_rate or 0.0) * 2.0
    penalty = float(v.penalty_rank_score or 0) * 0.15
    response = 1.0 / (1.0 + (v.response_time_ms_avg or 0) / 60000.0)
    base = rating * 0.35 + punct * 0.2 + completion * 0.25 + response * 0.15
    base -= cancel_penalty + noshow_penalty + penalty
    if v.new_shop_boost_until_unix and v.new_shop_boost_until_unix >= now:
        base += 0.35
    return base


def rank_vendors_for_city(
    db: Session,
    *,
    city_code: str,
    limit: int = 30,
    now_unix: int | None = None,
) -> list[dict[str, Any]]:
    now = now_unix or int(time.time())
    rows = list(
        db.scalars(
            select(Vendor)
            .where(Vendor.city_code == city_code)
            .order_by(Vendor.rating.desc())
            .limit(200)
        )
    )
    scored: list[tuple[float, Vendor]] = []
    for v in rows:
        ok, _ = is_vendor_listable(v, now_unix=now)
        if not ok:
            continue
        scored.append((_score_vendor(v, now=now), v))
    scored.sort(key=lambda x: x[0], reverse=True)
    out: list[dict[str, Any]] = []
    for s, v in scored[:limit]:
        out.append(
            {
                "vendor_id": v.id,
                "name": v.name,
                "city_code": v.city_code,
                "score": round(s, 4),
                "rating": v.rating,
                "punctuality_score": v.punctuality_score,
                "completion_rate": v.completion_rate,
                "cancellation_rate": v.cancellation_rate,
                "no_show_rate": v.no_show_rate,
                "response_time_ms_avg": v.response_time_ms_avg,
                "new_shop_boost_active": bool(
                    v.new_shop_boost_until_unix and v.new_shop_boost_until_unix >= now
                ),
            }
        )
    return out


def set_new_shop_boost(db: Session, vendor_id: str, days: int = 14) -> Vendor:
    v = db.get(Vendor, vendor_id)
    if not v:
        raise ValueError("vendor not found")
    v.new_shop_boost_until_unix = int(time.time()) + days * 86400
    db.add(v)
    db.commit()
    db.refresh(v)
    return v
