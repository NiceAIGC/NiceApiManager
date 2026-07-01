"""Client wrapper for Sub2API user-side synchronization flows."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx


class Sub2APIClientError(Exception):
    """Raised when a remote Sub2API instance returns an unusable response."""


@dataclass
class Sub2APISessionData:
    """Persistable authentication state for one Sub2API account."""

    remote_user_id: int
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None


class Sub2APIClient:
    """Small synchronous client for Sub2API user-side endpoints."""

    def __init__(
        self,
        base_url: str,
        *,
        timeout: float = 20.0,
        verify: bool = True,
        proxy: str | None = None,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.verify = verify
        self.proxy = proxy

    def login(self, email: str, password: str) -> Sub2APISessionData:
        """Authenticate with Sub2API email/password and capture the bearer token."""
        with self._build_client() as client:
            response = client.post(
                "/api/v1/auth/login",
                json={"email": email, "password": password},
            )
            payload = self._decode_response(response)
            data = self._extract_data(payload)

        if data.get("requires_2fa"):
            raise Sub2APIClientError("该 Sub2API 用户启用了 2FA，请改用访问密钥/JWT 同步。")

        access_token = _first_text(data, "access_token", "token", "jwt")
        if not access_token:
            raise Sub2APIClientError("Sub2API 登录响应未返回 access_token。")

        user_payload = data.get("user") if isinstance(data.get("user"), dict) else data
        remote_user_id = _extract_user_id(user_payload)
        if remote_user_id is None:
            remote_user_id = self.get_current_user(access_token).remote_user_id

        expires_in = _coerce_int(data.get("expires_in"))
        expires_at = (
            datetime.now(timezone.utc).replace(tzinfo=None) + timedelta(seconds=expires_in)
            if expires_in and expires_in > 0
            else None
        )

        return Sub2APISessionData(
            remote_user_id=remote_user_id,
            access_token=access_token,
            refresh_token=_first_text(data, "refresh_token"),
            expires_at=expires_at,
        )

    def get_current_user(self, access_token: str) -> Sub2APISessionData:
        """Validate a bearer token and return the current user identity."""
        with self._build_client(access_token=access_token) as client:
            response = client.get("/api/v1/auth/me")
            payload = self._decode_response(response)

        data = self._extract_data(payload)
        remote_user_id = _extract_user_id(data)
        if remote_user_id is None:
            raise Sub2APIClientError("Sub2API 当前用户响应未返回用户 ID。")

        return Sub2APISessionData(
            remote_user_id=remote_user_id,
            access_token=access_token,
            refresh_token=None,
            expires_at=None,
        )

    def get_user_self(self, session_data: Sub2APISessionData) -> dict[str, Any]:
        """Fetch current user quota, consumption, and request counters."""
        profile = self._safe_get("/api/v1/user/profile", session_data.access_token)
        current_user = self._safe_get("/api/v1/auth/me", session_data.access_token)
        dashboard_stats = self._safe_get("/api/v1/usage/dashboard/stats", session_data.access_token)
        usage_stats = self._safe_get("/api/v1/usage/stats", session_data.access_token)
        platform_quotas = self._safe_get("/api/v1/user/platform-quotas", session_data.access_token)

        profile_data = self._extract_data(profile)
        current_user_data = self._extract_data(current_user)
        dashboard_data = self._extract_data(dashboard_stats)
        usage_data = self._extract_data(usage_stats)
        quota_data = self._extract_data(platform_quotas)

        balance = _first_number(
            profile_data,
            "quota",
            "balance",
            "credit",
            "credits",
            "remaining_quota",
            "remaining_balance",
            "available_balance",
            "available_quota",
        )
        if balance is None:
            balance = _sum_numbers_from_tree(
                quota_data,
                (
                    "quota",
                    "balance",
                    "remaining_quota",
                    "remaining_balance",
                    "available_balance",
                    "available_quota",
                ),
            )

        used_quota = _first_number(
            dashboard_data,
            "used_quota",
            "total_quota",
            "total_cost",
            "cost",
            "amount",
            "usage_amount",
        )
        if used_quota is None:
            used_quota = _first_number(
                usage_data,
                "used_quota",
                "total_quota",
                "total_cost",
                "cost",
                "amount",
                "usage_amount",
            )

        request_count = _first_number(
            dashboard_data,
            "request_count",
            "requests",
            "total_requests",
            "total_count",
            "count",
        )
        if request_count is None:
            request_count = _first_number(
                usage_data,
                "request_count",
                "requests",
                "total_requests",
                "total_count",
                "count",
            )

        username = (
            _first_text(profile_data, "username", "name", "email")
            or _first_text(current_user_data, "username", "name", "email")
            or ""
        )
        group_name = (
            _first_text(profile_data, "group", "group_name", "role", "plan")
            or _first_text(current_user_data, "group", "group_name", "role", "plan")
        )

        return {
            "id": session_data.remote_user_id,
            "username": username,
            "group": group_name,
            "quota": int(round(balance or 0)),
            "used_quota": int(round(used_quota or 0)),
            "request_count": int(round(request_count or 0)),
        }

    def get_user_groups(self, session_data: Sub2APISessionData) -> dict[str, Any]:
        """Fetch user-visible group ratios when Sub2API exposes them."""
        available_payload = self._safe_get("/api/v1/groups/available", session_data.access_token)
        rates_payload = self._safe_get("/api/v1/groups/rates", session_data.access_token)
        available = self._extract_data(available_payload)
        rates = self._extract_data(rates_payload)
        return _normalize_groups(available, rates)

    def get_pricing(self, session_data: Sub2APISessionData) -> dict[str, Any]:
        """Map Sub2API dashboard model usage/cost statistics to local pricing rows."""
        models_payload = self._safe_get("/api/v1/usage/dashboard/models", session_data.access_token)
        models = _extract_items(self._extract_data(models_payload))
        rows: list[dict[str, Any]] = []

        for row in models:
            model_name = _first_text(row, "model_name", "model", "name", "id")
            if not model_name:
                continue
            rows.append(
                {
                    "model_name": model_name,
                    "vendor_id": _first_text(row, "platform", "provider", "vendor", "service"),
                    "quota_type": _coerce_int(row.get("quota_type"), 1),
                    "model_ratio": _first_number(row, "model_ratio", "ratio", "multiplier") or 1,
                    "model_price": _first_number(row, "model_price", "price", "unit_price", "cost_per_token") or 0,
                    "completion_ratio": _first_number(row, "completion_ratio", "model_completion_ratio") or 0,
                    "enable_groups": [],
                    "supported_endpoint_types": [
                        item
                        for item in [_first_text(row, "endpoint_type", "platform", "provider", "vendor")]
                        if item
                    ],
                }
            )

        return {"data": rows, "vendors": [], "group_data": {}}

    def get_daily_usage(
        self,
        session_data: Sub2APISessionData,
        *,
        start_timestamp: int,
        end_timestamp: int,
    ) -> list[dict[str, Any]]:
        """Fetch daily usage rows from Sub2API dashboard trend endpoints."""
        params = {
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp,
            "start": start_timestamp,
            "end": end_timestamp,
        }
        payload = self._safe_get("/api/v1/usage/dashboard/trend", session_data.access_token, params=params)
        rows = _extract_items(self._extract_data(payload))
        if rows:
            return [_normalize_daily_usage_row(row) for row in rows]

        return []

    def _safe_get(
        self,
        path: str,
        access_token: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        """Return an empty payload for optional Sub2API endpoints that are unavailable."""
        try:
            with self._build_client(access_token=access_token) as client:
                response = client.get(path, params=params)
                return self._decode_response(response)
        except Sub2APIClientError:
            return {}

    def _build_client(self, access_token: str | None = None) -> httpx.Client:
        """Create a short-lived HTTP client with optional bearer authentication."""
        headers: dict[str, str] = {}
        token_value = (access_token or "").strip()
        if token_value:
            headers["Authorization"] = token_value if token_value.lower().startswith("bearer ") else f"Bearer {token_value}"

        try:
            return httpx.Client(
                base_url=self.base_url,
                timeout=self.timeout,
                verify=self.verify,
                proxy=self.proxy,
                headers=headers,
                follow_redirects=True,
            )
        except ImportError as exc:
            if self.proxy and "socks" in self.proxy.lower():
                raise Sub2APIClientError("当前服务镜像未安装 SOCKS5 代理依赖，请重新构建并部署容器。") from exc
            raise

    def _decode_response(self, response: httpx.Response) -> dict[str, Any]:
        """Normalize Sub2API success/error handling."""
        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            raise Sub2APIClientError(f"Sub2API request failed with HTTP {response.status_code}.") from exc

        try:
            payload = response.json()
        except ValueError as exc:
            raise Sub2APIClientError("Sub2API response is not valid JSON.") from exc

        if not isinstance(payload, dict):
            raise Sub2APIClientError("Sub2API response is not a JSON object.")

        if payload.get("success") is False:
            raise Sub2APIClientError(_first_text(payload, "message", "error") or "Sub2API request reported failure.")

        error_payload = payload.get("error")
        if error_payload:
            if isinstance(error_payload, dict):
                message = _first_text(error_payload, "localized_message", "message", "detail")
            else:
                message = str(error_payload)
            raise Sub2APIClientError(message or "Sub2API request reported failure.")

        return payload

    @staticmethod
    def _extract_data(payload: object) -> Any:
        """Read common data envelopes while tolerating direct payload responses."""
        if not isinstance(payload, dict):
            return {}
        if "data" in payload:
            return payload.get("data")
        if "result" in payload:
            return payload.get("result")
        return payload


def _extract_user_id(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    for key in ("id", "user_id", "uid"):
        value = payload.get(key)
        parsed = _coerce_int(value)
        if parsed is not None and parsed > 0:
            return parsed
    return None


def _first_text(payload: object, *keys: str) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if value not in (None, "") and not isinstance(value, (dict, list)):
            return str(value).strip()
    return None


def _first_number(payload: object, *keys: str) -> float | None:
    if not isinstance(payload, dict):
        return None
    for key in keys:
        parsed = _coerce_float(payload.get(key))
        if parsed is not None:
            return parsed
    for value in payload.values():
        if isinstance(value, dict):
            parsed = _first_number(value, *keys)
            if parsed is not None:
                return parsed
    return None


def _sum_numbers_from_tree(payload: object, keys: tuple[str, ...]) -> float | None:
    total = 0.0
    found = False
    if isinstance(payload, dict):
        for key, value in payload.items():
            if key in keys:
                parsed = _coerce_float(value)
                if parsed is not None:
                    total += parsed
                    found = True
            elif isinstance(value, (dict, list)):
                nested = _sum_numbers_from_tree(value, keys)
                if nested is not None:
                    total += nested
                    found = True
    elif isinstance(payload, list):
        for item in payload:
            nested = _sum_numbers_from_tree(item, keys)
            if nested is not None:
                total += nested
                found = True
    return total if found else None


def _extract_items(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("items", "list", "data", "records", "models", "trend", "rows", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _normalize_groups(available: object, rates: object) -> dict[str, Any]:
    groups: dict[str, Any] = {}
    rate_map: dict[str, float] = {}

    if isinstance(rates, dict):
        for key, value in rates.items():
            parsed = _coerce_float(value)
            if parsed is not None:
                rate_map[str(key)] = parsed
            elif isinstance(value, dict):
                group_name = _first_text(value, "name", "group", "group_name", "id") or str(key)
                ratio = _first_number(value, "ratio", "rate", "multiplier")
                if ratio is not None:
                    rate_map[group_name] = ratio

    for row in _extract_items(available):
        group_name = _first_text(row, "name", "group", "group_name", "id")
        if not group_name:
            continue
        groups[group_name] = {
            "desc": _first_text(row, "description", "desc", "display_name"),
            "ratio": _first_number(row, "ratio", "rate", "rate_multiplier", "multiplier") or rate_map.get(group_name, 1),
        }

    for group_name, ratio in rate_map.items():
        groups.setdefault(group_name, {"desc": None, "ratio": ratio})

    return groups


def _normalize_daily_usage_row(row: dict[str, Any]) -> dict[str, Any]:
    timestamp = _first_timestamp(row)
    return {
        "created_at": timestamp,
        "count": int(round(_first_number(row, "request_count", "requests", "total_requests", "count") or 0)),
        "quota": int(round(_first_number(row, "used_quota", "quota", "cost", "total_cost", "amount") or 0)),
    }


def _first_timestamp(row: dict[str, Any]) -> int:
    value = row.get("created_at") or row.get("timestamp") or row.get("time")
    parsed = _coerce_int(value)
    if parsed is not None:
        return parsed

    date_value = _first_text(row, "date", "day", "usage_date")
    if date_value:
        try:
            return int(datetime.fromisoformat(date_value.replace("Z", "+00:00")).timestamp())
        except ValueError:
            pass

    return 0


def _coerce_float(value: object) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _coerce_int(value: object, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
