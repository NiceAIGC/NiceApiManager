"""Simple password-based auth helpers for the admin UI."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import timedelta
from typing import Any

from fastapi import Request

from app.core.config import get_settings
from app.core.time import utcnow


AUTH_COOKIE_NAME = "niceapimanager_session"


def verify_password(password: str) -> bool:
    """Return whether the submitted password matches the configured admin password."""
    settings = get_settings()
    return hmac.compare_digest(password, settings.auth_password)


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


def build_auth_status() -> dict[str, Any]:
    """Return frontend-friendly auth status metadata."""
    settings = get_settings()
    return {
        "authenticated": True,
        "session_days": settings.auth_session_days,
    }


def _sign_payload(payload_b64: str) -> str:
    """Sign one base64url payload string with the configured secret key."""
    settings = get_settings()
    digest = hmac.new(
        settings.auth_secret_key.encode("utf-8"),
        payload_b64.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _decode_payload(payload_b64: str) -> dict[str, Any]:
    """Decode one base64url JSON payload."""
    padding = "=" * (-len(payload_b64) % 4)
    raw = base64.urlsafe_b64decode(f"{payload_b64}{padding}".encode("ascii"))
    return json.loads(raw.decode("utf-8"))
