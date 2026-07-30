"""Client wrapper for the read-only NewAPI-compatible flows used by this project."""

from __future__ import annotations

import base64
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
import json
from urllib.parse import urlsplit
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
    refresh_token: str | None = None


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
        proxy: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.program_type = program_type
        self.timeout = timeout
        self.verify = verify
        self.proxy = proxy

    def with_program_type(self, program_type: str) -> "NewAPIClient":
        """Clone the client with a different detected upstream program type."""
        return NewAPIClient(
            base_url=self.base_url,
            program_type=program_type,
            timeout=self.timeout,
            verify=self.verify,
            proxy=self.proxy,
        )

    def _origin(self) -> str:
        """Return the exact URL origin required by modern New API's refresh guard."""
        parsed = urlsplit(self.base_url)
        return f"{parsed.scheme}://{parsed.netloc}"

    def login(self, username: str, password: str) -> NewAPISessionData:
        """Authenticate against legacy cookie and modern bearer-token New API releases."""
        with self._build_client() as client:
            response = client.post(
                "/api/user/login",
                json={"username": username, "password": password},
            )
            payload = self._decode_response(response)
            data = payload.get("data") or {}
            if not isinstance(data, dict):
                raise NewAPIClientError("Remote login response has an invalid data payload.")
            if data.get("require_2fa"):
                raise NewAPIClientError("远端账号已启用两步验证，账密同步暂不支持该登录方式。")

            access_token = self._extract_access_token(payload)
            refresh_token = client.cookies.get("new_api_refresh") or None
            cookie_value = client.cookies.get("session") or ""
            if not cookie_value and not access_token:
                raise NewAPIClientError("Remote instance did not return supported authentication credentials.")

            user_data = data.get("user") if isinstance(data.get("user"), dict) else data
            remote_user_id = user_data.get("id")
            if not remote_user_id:
                raise NewAPIClientError("Remote instance did not return a user ID.")

            expires_at = (
                self._extract_access_token_expiry(data, access_token)
                if access_token
                else self._extract_cookie_expiry(response, "session")
            )
            return NewAPISessionData(
                remote_user_id=int(remote_user_id),
                cookie_value=cookie_value,
                access_token=access_token,
                expires_at=expires_at,
                refresh_token=refresh_token,
            )

    def refresh(self, remote_user_id: int, refresh_token: str) -> NewAPISessionData:
        """Rotate a modern New API refresh token and return its new access token."""
        with self._build_client(refresh_token=refresh_token) as client:
            response = client.post("/api/user/auth/refresh", headers={"Origin": self._origin()})
            payload = self._decode_response(response)
            data = payload.get("data") or {}
            if not isinstance(data, dict):
                raise NewAPIClientError("Remote refresh response has an invalid data payload.")

            access_token = self._extract_access_token(payload)
            if not access_token:
                raise NewAPIClientError("Remote instance did not return a refreshed access token.")
            rotated_refresh_token = response.cookies.get("new_api_refresh") or refresh_token
            user_data = data.get("user")
            refreshed_user_id = user_data.get("id") if isinstance(user_data, dict) else None
            return NewAPISessionData(
                remote_user_id=int(refreshed_user_id or remote_user_id),
                cookie_value="",
                access_token=access_token,
                expires_at=self._extract_access_token_expiry(data, access_token),
                refresh_token=rotated_refresh_token,
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

    def get_user_quota_data(
        self,
        remote_user_id: int,
        cookie_value: str,
        access_token: str | None = None,
        *,
        start_timestamp: int,
        end_timestamp: int,
    ) -> list[dict[str, Any]]:
        """Fetch aggregated per-hour quota rows from the faster user data endpoint."""
        params = {
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp,
            "default_time": "day",
        }
        with self._build_client(
            remote_user_id=remote_user_id,
            cookie_value=cookie_value,
            access_token=access_token,
        ) as client:
            response = client.get("/api/data/self", params=params)
            data = self._decode_response(response).get("data")
            if not isinstance(data, list):
                return []
            return [row for row in data if isinstance(row, dict)]

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
        refresh_token: str | None = None,
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

        cookies = (
            {"new_api_refresh": refresh_token}
            if refresh_token
            else ({"session": cookie_value} if cookie_value else None)
        )
        try:
            return httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                verify=self.verify,
                proxy=self.proxy,
                headers=headers,
                cookies=cookies,
                follow_redirects=True,
            )
        except ImportError as exc:
            if self.proxy and "socks" in self.proxy.lower():
                raise NewAPIClientError("当前服务镜像未安装 SOCKS5 代理依赖，请重新构建并部署容器。") from exc
            raise

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
            if isinstance(row, dict):
                normalized[str(group_name)] = {
                    "desc": row.get("desc") or row.get("Description"),
                    "ratio": row.get("ratio", row.get("GroupRatio", 0)),
                }
                continue
            if isinstance(row, (int, float)):
                normalized[str(group_name)] = {"desc": None, "ratio": row}
        return normalized

    def _normalize_pricing_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        """Convert supported pricing schemas into the current storage format."""
        data_section = payload.get("data")

        if isinstance(data_section, list):
            return {
                "data": [
                    self._normalize_newapi_model_row(row)
                    for row in data_section
                    if isinstance(row, dict)
                ],
                "vendors": list(payload.get("vendors") or []),
                "group_data": self._normalize_group_payload(payload.get("group_ratio") or {}),
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

    @staticmethod
    def _normalize_newapi_model_row(row: dict[str, Any]) -> dict[str, Any]:
        """Preserve modern NewAPI pricing fields in one stable row shape."""
        normalized = dict(row)
        normalized["completion_ratio"] = row.get("completion_ratio", row.get("model_completion_ratio", 0))
        normalized["enable_groups"] = list(row.get("enable_groups") or [])
        normalized["supported_endpoint_types"] = list(row.get("supported_endpoint_types") or [])
        normalized["cache_ratio"] = row.get("cache_ratio")
        normalized["create_cache_ratio"] = row.get("create_cache_ratio")
        normalized["billing_mode"] = row.get("billing_mode")
        return normalized


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
    def _extract_access_token_expiry(data: dict[str, Any], access_token: str) -> datetime | None:
        """Read modern New API's expiry field, with the JWT claim as a compatibility fallback."""
        raw_expires_at = data.get("access_expires_at")
        try:
            expires_at = int(raw_expires_at)
        except (TypeError, ValueError):
            expires_at = 0
        if expires_at > 0:
            return datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None)

        try:
            encoded_payload = access_token.split(".")[1]
            encoded_payload += "=" * (-len(encoded_payload) % 4)
            claims = json.loads(base64.urlsafe_b64decode(encoded_payload))
            expires_at = int(claims.get("exp") or 0)
        except (IndexError, TypeError, ValueError, json.JSONDecodeError):
            return None
        if expires_at <= 0:
            return None
        return datetime.fromtimestamp(expires_at, timezone.utc).replace(tzinfo=None)

    @staticmethod
    def _extract_cookie_expiry(response: httpx.Response, cookie_name: str) -> datetime | None:
        """Parse one authentication cookie's expiry from Set-Cookie headers when present."""
        prefix = f"{cookie_name}="
        for raw_cookie in response.headers.get_list("set-cookie"):
            if not raw_cookie.startswith(prefix):
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
