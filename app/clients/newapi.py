"""Client wrapper for the read-only NewAPI-compatible flows used by this project."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from typing import Any

import httpx


class NewAPIClientError(Exception):
    """Raised when the remote NewAPI-compatible instance returns an unusable response."""


@dataclass(slots=True)
class NewAPISessionData:
    """Persistable authentication state for one remote account."""

    remote_user_id: int
    cookie_value: str
    access_token: str | None
    expires_at: datetime | None


def detect_program_type(status_data: dict[str, Any], configured_program_type: str = "newapi") -> str:
    """Infer the concrete upstream program type from a public status payload."""
    if not isinstance(status_data, dict):
        return configured_program_type

    if any(key in status_data for key in ("rix_license_enabled", "rix_version_message", "rixapi_license_type")):
        return "rixapi"

    if any(
        key in status_data
        for key in (
            "ShellApiLogOptimizerEnabled",
            "CustomThemeConfig",
            "DataExportInterval",
            "instanceId",
            "PureHomePageEnabled",
        )
    ):
        return "shellapi"

    system_name = str(status_data.get("system_name") or "").lower()
    version = str(status_data.get("version") or "")
    if "shell api" in system_name or "shellapi" in system_name:
        return "shellapi"
    if version.startswith("v") and "alpha" in version:
        return "shellapi"

    return configured_program_type


class NewAPIClient:
    """Small synchronous client for NewAPI-compatible user-side endpoints."""

    def __init__(
        self,
        base_url: str,
        *,
        program_type: str = "newapi",
        timeout: float = 20.0,
        verify: bool = True,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.program_type = program_type
        self.timeout = timeout
        self.verify = verify

    def with_program_type(self, program_type: str) -> "NewAPIClient":
        """Clone the client with a different detected upstream program type."""
        return NewAPIClient(
            base_url=self.base_url,
            program_type=program_type,
            timeout=self.timeout,
            verify=self.verify,
        )

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
                access_token=self._extract_access_token(payload),
                expires_at=expires_at,
            )

    def get_user_self(
        self,
        remote_user_id: int,
        cookie_value: str,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        """Fetch the current user profile with quota and request counters."""
        with self._build_client(
            remote_user_id=remote_user_id,
            cookie_value=cookie_value,
            access_token=access_token,
        ) as client:
            response = client.get("/api/user/self")
            return self._decode_response(response).get("data") or {}

    def get_user_groups(
        self,
        remote_user_id: int,
        cookie_value: str,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        """Fetch user-visible group ratios."""
        try:
            with self._build_client(
                remote_user_id=remote_user_id,
                cookie_value=cookie_value,
                access_token=access_token,
            ) as client:
                response = client.get("/api/user/self/groups")
                return self._normalize_group_payload(self._decode_response(response).get("data") or {})
        except NewAPIClientError:
            pricing_payload = self.get_pricing(remote_user_id, cookie_value, access_token)
            return pricing_payload.get("group_data") or {}

    def get_pricing(
        self,
        remote_user_id: int,
        cookie_value: str,
        access_token: str | None = None,
    ) -> dict[str, Any]:
        """Fetch the user-visible pricing configuration and model metadata."""
        with self._build_client(
            remote_user_id=remote_user_id,
            cookie_value=cookie_value,
            access_token=access_token,
        ) as client:
            response = client.get("/api/pricing")
            return self._normalize_pricing_payload(self._decode_response(response))

    def get_user_logs(
        self,
        remote_user_id: int,
        cookie_value: str,
        access_token: str | None = None,
        *,
        page: int = 1,
        page_size: int = 100,
        log_type: int | None = None,
        start_timestamp: int | None = None,
        end_timestamp: int | None = None,
    ) -> dict[str, Any]:
        """Fetch paginated user logs for one remote account."""
        params = {
            "p": page,
            "page_size": page_size,
            "type": log_type,
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp,
        }
        with self._build_client(
            remote_user_id=remote_user_id,
            cookie_value=cookie_value,
            access_token=access_token,
        ) as client:
            response = client.get("/api/log/self", params={key: value for key, value in params.items() if value is not None})
            return self._normalize_logs_payload(self._decode_response(response).get("data"))

    def get_status(self) -> dict[str, Any]:
        """Fetch public system status metadata such as `quota_per_unit`."""
        with self._build_client() as client:
            response = client.get("/api/status")
            return self._decode_response(response).get("data") or {}

    def _build_client(
        self,
        remote_user_id: int | None = None,
        cookie_value: str | None = None,
        access_token: str | None = None,
    ) -> httpx.Client:
        """Create a short-lived HTTP client with the required auth headers."""
        headers: dict[str, str] = {}
        if remote_user_id is not None:
            headers["New-API-User"] = str(remote_user_id)
            if self.program_type == "rixapi":
                headers["Rix-Api-User"] = str(remote_user_id)

        token_value = (access_token or "").strip()
        if token_value:
            headers["Authorization"] = token_value if token_value.lower().startswith("bearer ") else f"Bearer {token_value}"

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
        """Normalize success/error handling across upstream endpoints."""
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise NewAPIClientError(f"Remote request failed with HTTP {response.status_code}.") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise NewAPIClientError("Remote response is not valid JSON.") from exc

        error_payload = payload.get("error")
        if error_payload is not None:
            if isinstance(error_payload, dict):
                message = (
                    error_payload.get("localized_message")
                    or error_payload.get("message")
                    or payload.get("message")
                )
            else:
                message = str(error_payload)
            raise NewAPIClientError(message or "Remote request reported failure.")

        if payload.get("success") is False:
            raise NewAPIClientError(payload.get("message") or "Remote request reported failure.")

        return payload

    def _normalize_group_payload(self, payload: object) -> dict[str, Any]:
        """Convert supported group payload shapes into one stable mapping."""
        if not isinstance(payload, dict):
            return {}

        normalized: dict[str, Any] = {}
        for group_name, row in payload.items():
            if not isinstance(row, dict):
                continue
            normalized[str(group_name)] = {
                "desc": row.get("desc") or row.get("Description"),
                "ratio": row.get("ratio", row.get("GroupRatio", 0)),
            }
        return normalized

    def _normalize_pricing_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Convert supported pricing schemas into the current storage format."""
        data_section = payload.get("data")

        if isinstance(data_section, list):
            return {
                "data": data_section,
                "vendors": list(payload.get("vendors") or []),
                "group_data": {},
            }

        if isinstance(data_section, dict) and "model_info" in data_section:
            return {
                "data": [
                    self._normalize_rix_model_row(row)
                    for row in data_section.get("model_info") or []
                    if isinstance(row, dict)
                ],
                "vendors": list(data_section.get("vendor_info") or []),
                "group_data": self._normalize_group_payload(data_section.get("group_info") or {}),
            }

        if isinstance(data_section, dict):
            return self._normalize_shell_pricing_payload(data_section)

        return {"data": [], "vendors": [], "group_data": {}}

    def _normalize_rix_model_row(self, row: dict[str, Any]) -> dict[str, Any]:
        """Flatten one RixAPI pricing row into the stored pricing schema."""
        pricing = self._pick_nested_pricing_row(row.get("price_info") or {})
        return {
            "model_name": row.get("model_name"),
            "vendor_id": row.get("vendor_id"),
            "quota_type": pricing.get("quota_type", 0),
            "model_ratio": pricing.get("model_ratio", 0),
            "model_price": pricing.get("model_price", 0),
            "completion_ratio": pricing.get("model_completion_ratio", 0),
            "enable_groups": list(row.get("enable_groups") or []),
            "supported_endpoint_types": list(row.get("supported_endpoint_types") or []),
        }

    def _normalize_shell_pricing_payload(self, data_section: dict[str, Any]) -> dict[str, Any]:
        """Map ShellAPI pricing dictionaries into row-oriented pricing data."""
        models = [item for item in data_section.get("Models") or [] if isinstance(item, str)]
        model_ratio = data_section.get("ModelRatio") or {}
        model_fixed_price = data_section.get("ModelFixedPrice") or {}
        completion_ratio = data_section.get("CompletionRatio") or {}
        group_ratio = data_section.get("GroupRatio") or {}

        rows = []
        for model_name in models:
            rows.append(
                {
                    "model_name": model_name,
                    "vendor_id": None,
                    "quota_type": 0 if model_name in model_fixed_price else 1,
                    "model_ratio": model_ratio.get(model_name, 0),
                    "model_price": model_fixed_price.get(model_name, 0),
                    "completion_ratio": completion_ratio.get(model_name, 0),
                    "enable_groups": list(group_ratio.keys()),
                    "supported_endpoint_types": [],
                }
            )

        group_data = {
            group_name: {"desc": None, "ratio": ratio}
            for group_name, ratio in group_ratio.items()
        }
        return {"data": rows, "vendors": [], "group_data": group_data}

    @staticmethod
    def _normalize_logs_payload(data_section: object) -> dict[str, Any]:
        """Convert upstream log payloads into the `{items, total}` shape used by sync."""
        if isinstance(data_section, dict):
            raw_items = data_section.get("items")
            if isinstance(raw_items, list):
                normalized = dict(data_section)
                normalized["items"] = raw_items
                normalized["total"] = data_section.get("total", len(raw_items))
                return normalized
            return data_section

        if isinstance(data_section, list):
            return {"items": data_section, "total": len(data_section)}

        return {"items": [], "total": 0}

    @staticmethod
    def _pick_nested_pricing_row(price_info: object) -> dict[str, Any]:
        """Pick a representative default price row from nested pricing dictionaries."""
        if not isinstance(price_info, dict):
            return {}

        preferred_groups = ["default", *price_info.keys()]
        for group_name in preferred_groups:
            group_payload = price_info.get(group_name)
            if not isinstance(group_payload, dict):
                continue
            if isinstance(group_payload.get("default"), dict):
                return group_payload["default"]
            for candidate in group_payload.values():
                if isinstance(candidate, dict):
                    return candidate

        return {}

    @staticmethod
    def _extract_access_token(payload: dict[str, Any]) -> str | None:
        """Read the returned access token from a login or profile payload when present."""
        data = payload.get("data") or {}
        token = data.get("access_token")
        if not isinstance(token, str):
            return None
        token = token.strip()
        return token or None

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
