from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import app.models  # noqa: F401  registers ORM tables on Base.metadata
from fastapi import Request
from app.api.admin_router import router as admin_router
from app.api.bookings_router import router as bookings_router
from app.api.marketplace_router import router as marketplace_router
from app.api.vendors_router import router as vendors_router
from app.api.webhook_handler import router as webhook_router
from app.config import get_settings
from app.db.session import Base, get_engine, init_engine
from app.routers import route_split


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    init_engine(settings.database_url)
    Base.metadata.create_all(bind=get_engine())
    yield


app = FastAPI(
    title="Barber marketplace backend",
    description="India-first marketplace: slot holds, flexible fees, salon bookings, Razorpay phases, admin analytics.",
    version="2.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(webhook_router, prefix="")

@app.middleware("http")
async def chaos_propagation_middleware(request: Request, call_next):
    from app.failure_injection import set_chaos_profile
    import json
    profile_header = request.headers.get("X-Failure-Profile")
    if profile_header:
        try:
            profile = json.loads(profile_header)
            set_chaos_profile(profile)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(f"Failed to parse X-Failure-Profile: {e}")
    response = await call_next(request)
    return response

app.include_router(admin_router)
app.include_router(vendors_router)
app.include_router(bookings_router)
app.include_router(marketplace_router)
app.include_router(route_split.router, prefix="/api/v1/razorpay")


@app.get("/")
async def root() -> dict[str, str]:
    return {"service": "shop-route-payments", "docs": "/docs"}
