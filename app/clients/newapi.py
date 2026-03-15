"""Client wrapper for the read-only NewAPI flows used by this project."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx


class NewAPIClientError(Exception):
    """Raised when the remote NewAPI instance returns an unusable response."""


@dataclass(slots=True)
class NewAPISessionData:
    """Persistable authentication state for one remote NewAPI account."""

    remote_user_id: int
    cookie_value: str
    expires_at: datetime | None


class NewAPIClient:
    """Small synchronous client for the tested NewAPI user-side endpoints."""

    def __init__(self, base_url: str, timeout: float = 20.0, verify: bool = True) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify = verify

    def login(self, username: str, password: str) -> NewAPISessionData:
        """Authenticate with username/password and capture the session cookie."""
        with self._build_client() as client:
            response = client.post(
                "/api/user/login",
                json={"username": username, "password": password},
            )
            payload = self._decode_response(response)
            cookie_value = client.cookies.get("session")
            if not cookie_value:
                raise NewAPIClientError("Remote instance did not return a session cookie.")

            user_data = payload.get("data") or {}
            remote_user_id = user_data.get("id")
            if not remote_user_id:
                raise NewAPIClientError("Remote instance did not return a user ID.")

            expires_at = self._extract_cookie_expiry(response)
            return NewAPISessionData(
                remote_user_id=int(remote_user_id),
                cookie_value=cookie_value,
                expires_at=expires_at,
            )

    def get_user_self(self, remote_user_id: int, cookie_value: str) -> dict[str, Any]:
        """Fetch the current user profile with quota and request counters."""
        with self._build_client(remote_user_id=remote_user_id, cookie_value=cookie_value) as client:
            response = client.get("/api/user/self")
            return self._decode_response(response).get("data") or {}

    def get_user_groups(self, remote_user_id: int, cookie_value: str) -> dict[str, Any]:
        """Fetch user-visible group ratios."""
        with self._build_client(remote_user_id=remote_user_id, cookie_value=cookie_value) as client:
            response = client.get("/api/user/self/groups")
            return self._decode_response(response).get("data") or {}

    def get_pricing(self, remote_user_id: int, cookie_value: str) -> dict[str, Any]:
        """Fetch the user-visible pricing configuration and model metadata."""
        with self._build_client(remote_user_id=remote_user_id, cookie_value=cookie_value) as client:
            response = client.get("/api/pricing")
            return self._decode_response(response)

    def get_status(self) -> dict[str, Any]:
        """Fetch public system status metadata such as `quota_per_unit`."""
        with self._build_client() as client:
            response = client.get("/api/status")
            return self._decode_response(response).get("data") or {}

    def _build_client(
        self,
        remote_user_id: int | None = None,
        cookie_value: str | None = None,
    ) -> httpx.Client:
        """Create a short-lived HTTP client with the required user headers."""
        headers: dict[str, str] = {}
        if remote_user_id is not None:
            headers["New-API-User"] = str(remote_user_id)

        cookies = {"session": cookie_value} if cookie_value else None
        return httpx.Client(
            base_url=self.base_url,
            timeout=self.timeout,
            verify=self.verify,
            headers=headers,
            cookies=cookies,
            follow_redirects=True,
        )

    def _decode_response(self, response: httpx.Response) -> dict[str, Any]:
        """Normalize success/error handling across NewAPI endpoints."""
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise NewAPIClientError(f"Remote request failed with HTTP {response.status_code}.") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise NewAPIClientError("Remote response is not valid JSON.") from exc

        if payload.get("success") is False:
            raise NewAPIClientError(payload.get("message") or "Remote request reported failure.")

        return payload

    @staticmethod
    def _extract_cookie_expiry(response: httpx.Response) -> datetime | None:
        """Parse the `session` cookie expiry from Set-Cookie headers when present."""
        for raw_cookie in response.headers.get_list("set-cookie"):
            if not raw_cookie.startswith("session="):
                continue

            parts = [part.strip() for part in raw_cookie.split(";")]
            attributes = {}
            for item in parts[1:]:
                if "=" in item:
                    key, value = item.split("=", 1)
                    attributes[key.lower()] = value

            if "expires" in attributes:
                parsed = parsedate_to_datetime(attributes["expires"])
                return parsed.astimezone(timezone.utc).replace(tzinfo=None)

            if "max-age" in attributes:
                return (datetime.now(timezone.utc) + timedelta(seconds=int(attributes["max-age"]))).replace(
                    tzinfo=None
                )

        return None
