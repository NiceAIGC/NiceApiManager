"""Database engine and session management."""

from pathlib import Path

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()
database_url = make_url(settings.database_url)


def prepare_database_directory() -> None:
    """Create the SQLite parent directory so local startup never fails on path creation."""
    if database_url.get_backend_name() != "sqlite":
        return

    database_path = database_url.database or ""
    if not database_path or database_path == ":memory:":
        return

    Path(database_path).parent.mkdir(parents=True, exist_ok=True)


prepare_database_directory()

connect_args = {"check_same_thread": False} if database_url.get_backend_name() == "sqlite" else {}

engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True, class_=Session)

