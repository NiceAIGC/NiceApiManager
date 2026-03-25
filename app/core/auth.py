"""Simple password-based auth helpers for the admin UI."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
from datetime import timedelta

from fastapi import Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utcnow
from app.models import AppSetting


AUTH_COOKIE_NAME = "niceapimanager_session"


def verify_password(db: Session, password: str) -> bool:
    """Return whether the submitted password matches the configured admin password."""
    settings = get_settings()
    app_setting = db.scalar(select(AppSetting).order_by(AppSetting.id.asc()).limit(1))

    if app_setting and app_setting.auth_password_hash:
        return _verify_password_hash(password, app_setting.auth_password_hash)

    return hmac.compare_digest(password, settings.auth_password)


def update_password(db: Session, new_password: str) -> None:
    """Persist a new admin password hash."""
    app_setting = db.scalar(select(AppSetting).order_by(AppSetting.id.asc()).limit(1))
    if app_setting is None:
        app_setting = AppSetting()
        db.add(app_setting)

    app_setting.auth_password_hash = _hash_password(new_password)
    db.commit()


def create_session_token() -> str:
    """Create a signed session token with a long-lived expiration timestamp."""
    settings = get_settings()
    expires_at = utcnow() + timedelta(days=settings.auth_session_days)
    payload = {"exp": int(expires_at.timestamp())}
    payload_bytes = json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")
    payload_b64 = base64.urlsafe_b64encode(payload_bytes).rstrip(b"=").decode("ascii")
    signature = _sign_payload(payload_b64)
    return f"{payload_b64}.{signature}"


def is_authenticated_request(request: Request) -> bool:
    """Check whether the request carries a valid signed session cookie."""
    token = request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        return False

    try:
        payload_b64, signature = token.split(".", 1)
    except ValueError:
        return False

    if not hmac.compare_digest(signature, _sign_payload(payload_b64)):
        return False

    try:
        payload = _decode_payload(payload_b64)
    except (ValueError, json.JSONDecodeError):
        return False

    expires_at = payload.get("exp")
    if not isinstance(expires_at, int):
        return False

    return expires_at > int(utcnow().timestamp())


def _hash_password(password: str) -> str:
    """Hash one password for durable storage."""
    iterations = 600_000
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    salt_b64 = base64.urlsafe_b64encode(salt).decode("ascii")
    digest_b64 = base64.urlsafe_b64encode(digest).decode("ascii")
    return f"pbkdf2_sha256${iterations}${salt_b64}${digest_b64}"


def _verify_password_hash(password: str, password_hash: str) -> bool:
    """Verify one plaintext password against the stored hash."""
    try:
        algorithm, iterations_text, salt_b64, digest_b64 = password_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    try:
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected_digest = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
    except (ValueError, TypeError):
        return False

    actual_digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    return hmac.compare_digest(actual_digest, expected_digest)


def _sign_payload(payload_b64: str) -> str:
    """Sign one base64url payload string with the configured secret key."""
    settings = get_settings()
    digest = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _decode_payload(payload_b64: str) -> dict[str, object]:
    """Decode one base64url JSON payload."""
    padding = "=" * (-len(payload_b64) % 4)
    raw = base64.urlsafe_b64decode(f"{payload_b64}{padding}".encode("ascii"))
    return json.loads(raw.decode("utf-8"))
