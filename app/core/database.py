"""Database engine and session management."""

from pathlib import Path
from threading import RLock

from sqlalchemy import create_engine, event
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import get_settings


settings = get_settings()
database_url = make_url(settings.database_url)
SQLITE_BUSY_TIMEOUT_MS = 30_000
SQLITE_WRITE_LOCK = RLock()


def prepare_database_directory() -> None:
    """Create the SQLite parent directory so local startup never fails on path creation."""
    if database_url.get_backend_name() != "sqlite":
        return

    database_path = database_url.database or ""
    if not database_path or database_path == ":memory:":
        return

    Path(database_path).parent.mkdir(parents=True, exist_ok=True)


prepare_database_directory()

connect_args = (
    {
        "check_same_thread": False,
        "timeout": SQLITE_BUSY_TIMEOUT_MS / 1000,
    }
    if database_url.get_backend_name() == "sqlite"
    else {}
)

engine = create_engine(settings.database_url, future=True, connect_args=connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True, class_=Session)


if database_url.get_backend_name() == "sqlite":

    @event.listens_for(engine, "connect")
    def _configure_sqlite_connection(dbapi_connection, _connection_record) -> None:
        """Apply SQLite pragmas that reduce write-lock contention."""
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.execute(f"PRAGMA busy_timeout={SQLITE_BUSY_TIMEOUT_MS}")
        if database_url.database not in ("", ":memory:"):
            cursor.execute("PRAGMA journal_mode=WAL")
            cursor.execute("PRAGMA synchronous=NORMAL")
        cursor.close()


def is_sqlite_locked_error(exc: Exception) -> bool:
    """Return whether an exception came from SQLite write-lock contention."""
    return database_url.get_backend_name() == "sqlite" and "database is locked" in str(exc).lower()


def sqlite_write_lock():
    """Return the process-local write lock used to serialize SQLite mutations."""
    return SQLITE_WRITE_LOCK
