from __future__ import annotations

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


def _ensure_sqlite_dir(url: str) -> None:
    if url.startswith("sqlite:///./"):
        path = url.replace("sqlite:///./", "", 1)
        parent = os.path.dirname(os.path.abspath(path))
        if parent:
            os.makedirs(parent, exist_ok=True)


_engine = None
_SessionLocal: sessionmaker[Session] | None = None


def init_engine(database_url: str) -> None:
    global _engine, _SessionLocal
    if _engine is not None:
        return
    _ensure_sqlite_dir(database_url) if database_url.startswith("sqlite") else None
    connect_args = {"check_same_thread": False} if database_url.startswith("sqlite") else {}
    _engine = create_engine(database_url, echo=False, connect_args=connect_args)
    _SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def get_engine():
    if _engine is None:
        raise RuntimeError("DB not initialized")
    return _engine


def get_session_local() -> sessionmaker[Session]:
    if _SessionLocal is None:
        raise RuntimeError("DB not initialized")
    return _SessionLocal


def get_db() -> Generator[Session, None, None]:
    SessionLocal = get_session_local()
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
