"""External API key issuance and verification."""

from __future__ import annotations

import hashlib
import secrets

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import ApiKey

KEY_PREFIX = "nam-"


def _hash_key(plaintext: str) -> str:
    """Return the SHA-256 hex digest used for at-rest key comparison."""
    return hashlib.sha256(plaintext.encode("utf-8")).hexdigest()


def create_api_key(db: Session, name: str) -> tuple[ApiKey, str]:
    """Issue one API key; the plaintext is returned exactly once."""
    plaintext = f"{KEY_PREFIX}{secrets.token_hex(24)}"
    record = ApiKey(
        name=name.strip(),
        key_prefix=plaintext[: len(KEY_PREFIX) + 6],
        key_hash=_hash_key(plaintext),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record, plaintext


def verify_api_key(db: Session, plaintext: str) -> ApiKey | None:
    """Resolve an enabled API key, stamping last_used_at on success."""
    if not plaintext.startswith(KEY_PREFIX):
        return None
    record = db.scalar(select(ApiKey).where(ApiKey.key_hash == _hash_key(plaintext)))
    if record is None or not record.enabled:
        return None
    record.last_used_at = utcnow()
    db.commit()
    return record
