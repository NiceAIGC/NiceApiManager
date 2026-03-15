"""Shared time helpers."""

from datetime import datetime, timezone


def utcnow() -> datetime:
    """Return a naive UTC timestamp compatible with SQLite datetime round-tripping."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
