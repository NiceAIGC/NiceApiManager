"""Client wrapper for Sub2API user-side synchronization flows.

Mapped against the current Sub2API backend (github.com/Wei-Shaw/sub2api):

- Balance: `GET /api/v1/user/profile` → `balance` / `frozen_balance` (USD).
- Consumption: `GET /api/v1/usage/dashboard/stats` → `total_actual_cost`
  (actually deducted) with `total_cost` (standard billing) as fallback.
- Daily usage: `GET /api/v1/usage/dashboard/trend` → `{trend: [{date,
  requests, cost, actual_cost}]}` (user timezone via `timezone` param).
- Groups: `GET /api/v1/model-plaza` (preferred: platform, user multiplier,
  peak window, long-context flag, per-model pricing) with
  `/api/v1/groups/available` + `/api/v1/groups/rates` as fallback.

Money values are floats in USD. This project stores them as micro-USD
integers (quota_per_unit = 1_000_000) so cents survive the integer quota
columns shared with NewAPI.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
import math
from typing import Any

import httpx

# Amount of micro-USD units per 1 USD. Sub2API quota counters are stored in
# these units so `quota / quota_per_unit` yields the exact USD balance.
MICRO_USD_PER_UNIT = 1_000_000.0


class Sub2APIClientError(Exception):
    """Raised when a remote Sub2API instance returns an unusable response."""


@dataclass
class Sub2APISessionData:
    """Persistable authentication state for one Sub2API account."""

    remote_user_id: int
    access_token: str
    expires_at: datetime | None
    refresh_token: str | None = None


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
        """Fetch current user balance, consumption, and request counters.

        Returned counters use the shared snapshot contract: `quota` is the
        remaining balance in micro-USD, `used_quota` the cumulative actually
        deducted amount in micro-USD.
        """
        profile = self._safe_get("/api/v1/user/profile", session_data.access_token)
        current_user = self._safe_get("/api/v1/auth/me", session_data.access_token)
        dashboard_stats = self._safe_get("/api/v1/usage/dashboard/stats", session_data.access_token)
        usage_stats = self._safe_get("/api/v1/usage/stats", session_data.access_token)

        profile_data = self._extract_data(profile)
        current_user_data = self._extract_data(current_user)
        dashboard_data = self._extract_data(dashboard_stats)
        usage_data = self._extract_data(usage_stats)

        balance = _first_number(
            profile_data,
            "balance",
            "quota",
            "credit",
            "remaining_balance",
            "available_balance",
        )
        frozen_balance = _first_number(profile_data, "frozen_balance")

        # Prefer the actually deducted total; fall back to standard billing.
        used_usd = _first_number(
            dashboard_data,
            "total_actual_cost",
            "used_quota",
            "total_cost",
            "total_quota",
        )
        if used_usd is None:
            used_usd = _first_number(
                usage_data,
                "total_actual_cost",
                "used_quota",
                "total_cost",
                "total_quota",
            )

        request_count = _first_number(
            dashboard_data,
            "total_requests",
            "request_count",
            "requests",
            "total_count",
        )
        if request_count is None:
            request_count = _first_number(
                usage_data,
                "total_requests",
                "request_count",
                "requests",
                "total_count",
            )

        username = (
            _first_text(profile_data, "username", "email")
            or _first_text(current_user_data, "username", "email")
            or ""
        )
        role = (
            _first_text(profile_data, "role")
            or _first_text(current_user_data, "role")
        )

        return {
            "id": session_data.remote_user_id,
            "username": username,
            "role": role,
            # Micro-USD integer counters (see module docstring).
            "quota": _usd_to_micro(balance or 0.0),
            "used_quota": _usd_to_micro(used_usd or 0.0),
            "request_count": int(round(request_count or 0)),
            "frozen_balance_usd": frozen_balance,
        }

    def get_user_groups(self, session_data: Sub2APISessionData) -> dict[str, Any]:
        """Fetch user-visible group data, preferring the richer model plaza."""
        plaza = self.get_model_plaza(session_data)
        if plaza is not None:
            groups = _groups_from_plaza(plaza)
            if groups:
                return groups

        available_payload = self._safe_get("/api/v1/groups/available", session_data.access_token)
        rates_payload = self._safe_get("/api/v1/groups/rates", session_data.access_token)
        available = self._extract_data(available_payload)
        rates = self._extract_data(rates_payload)
        return _normalize_groups(available, rates)

    def get_model_plaza(self, session_data: Sub2APISessionData) -> dict[str, Any] | None:
        """Fetch `/api/v1/model-plaza`, or None when the feature is unavailable."""
        return self._safe_get_json("/api/v1/model-plaza", session_data.access_token)

    def get_pricing(self, session_data: Sub2APISessionData) -> dict[str, Any]:
        """Build pricing rows from the model plaza (usage-stats fallback)."""
        plaza = self.get_model_plaza(session_data)
        if plaza is not None:
            rows, groups = _pricing_from_plaza(plaza)
            if rows:
                return {
                    "data": rows,
                    "vendors": [],
                    "group_data": groups,
                    "source": "model_plaza",
                }

        models_payload = self._safe_get("/api/v1/usage/dashboard/models", session_data.access_token)
        models = _extract_items(self._extract_data(models_payload))
        rows: list[dict[str, Any]] = []
        for row in models:
            model_name = _first_text(row, "model", "model_name", "name", "id")
            if not model_name:
                continue
            cost = _first_number(row, "actual_cost", "cost")
            rows.append(
                {
                    "model_name": model_name,
                    "vendor_id": None,
                    "vendor_name": _first_text(row, "platform", "provider", "vendor"),
                    "quota_type": 0,
                    "model_ratio": 0,
                    "model_price": 0,
                    "completion_ratio": 0,
                    "enable_groups": [],
                    "supported_endpoint_types": [],
                    "usage_cost_usd": cost,
                }
            )
        return {"data": rows, "vendors": [], "group_data": {}, "source": "usage_models"}

    def get_daily_usage(
        self,
        session_data: Sub2APISessionData,
        *,
        start_timestamp: int,
        end_timestamp: int,
        timezone_name: str | None = None,
    ) -> list[dict[str, Any]]:
        """Fetch daily usage rows from the Sub2API dashboard trend endpoint.

        Trend rows are keyed by local `date` (YYYY-MM-DD); pass the manager's
        display timezone so remote aggregation matches the local day split.
        """
        params: dict[str, Any] = {
            "start_timestamp": start_timestamp,
            "end_timestamp": end_timestamp,
        }
        tz = (timezone_name or "").strip()
        if tz:
            # Trend rows are keyed by local date strings; align the remote
            # aggregation window with the manager's configured timezone.
            tzinfo = _resolve_timezone(tz)
            start_local = datetime.fromtimestamp(start_timestamp, timezone.utc).astimezone(tzinfo)
            end_local = datetime.fromtimestamp(max(end_timestamp - 1, start_timestamp), timezone.utc).astimezone(tzinfo)
            params["timezone"] = tz
            params["start_date"] = start_local.strftime("%Y-%m-%d")
            params["end_date"] = end_local.strftime("%Y-%m-%d")

        payload = self._safe_get(
            "/api/v1/usage/dashboard/trend", session_data.access_token, params=params
        )
        rows = _extract_items(self._extract_data(payload))
        # The payload nests rows under `trend` on current Sub2API releases.
        if not rows and isinstance(payload, dict):
            data = self._extract_data(payload)
            rows = _extract_items(data.get("trend") if isinstance(data, dict) else data)
        return [_normalize_daily_usage_row(row) for row in rows]

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

    def _safe_get_json(
        self,
        path: str,
        access_token: str,
        params: dict[str, Any] | None = None,
    ) -> dict[str, Any] | None:
        """Like `_safe_get` but distinguishes "endpoint disabled" (None) from empty."""
        try:
            with self._build_client(access_token=access_token) as client:
                response = client.get(path, params=params)
                return self._decode_response(response)
        except Sub2APIClientError:
            return None

    def _build_client(self, access_token: str | None = None) -> httpx.Client:
        """Create a short-lived HTTP client with optional bearer authentication."""
        headers: dict[str, str] = {"Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8"}
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
        payload: object | None = None
        try:
            payload = response.json()
        except ValueError:
            payload = None

        try:
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            message = _extract_error_message(payload)
            raise Sub2APIClientError(
                f"Sub2API request failed with HTTP {response.status_code}: {message}"
                if message
                else f"Sub2API request failed with HTTP {response.status_code}."
            ) from exc

        if not isinstance(payload, dict):
            raise Sub2APIClientError("Sub2API response is not a JSON object.")

        if payload.get("success") is False:
            raise Sub2APIClientError(_first_text(payload, "message", "error") or "Sub2API request reported failure.")

        code = payload.get("code")
        if code not in (None, 0, "0"):
            raise Sub2APIClientError(_extract_error_message(payload) or "Sub2API request reported failure.")

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


def _usd_to_micro(amount: float) -> int:
    """Convert a USD float into micro-USD integer quota units."""
    if not math.isfinite(amount):
        return 0
    return int(round(amount * MICRO_USD_PER_UNIT))


def _usd_per_token_to_per_million(value: object) -> float | None:
    """Sub2API stores USD-per-token prices; normalize to USD per 1M tokens."""
    parsed = _coerce_float(value)
    if parsed is None:
        return None
    return parsed * 1_000_000.0


def _groups_from_plaza(plaza: dict[str, Any]) -> dict[str, Any]:
    """Map model plaza groups into the shared group payload shape."""
    data = Sub2APIClient._extract_data(plaza)
    groups_raw = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups_raw, list):
        return {}

    groups: dict[str, Any] = {}
    for row in groups_raw:
        if not isinstance(row, dict):
            continue
        group_name = _first_text(row, "name")
        if not group_name:
            continue
        user_ratio = _first_number(row, "user_rate_multiplier")
        peak_enabled = bool(row.get("peak_rate_enabled"))
        extra: dict[str, Any] = {
            "group_id": _coerce_int(row.get("id")),
            "subscription_type": row.get("subscription_type") or None,
            "is_exclusive": bool(row.get("is_exclusive")),
            "peak_rate_enabled": peak_enabled,
            "long_context_pricing_enabled": bool(row.get("long_context_pricing_enabled")),
            "image_rate_multiplier": _first_number(row, "image_rate_multiplier"),
            "video_rate_multiplier": _first_number(row, "video_rate_multiplier"),
        }
        groups[group_name] = {
            "desc": _first_text(row, "description"),
            "ratio": _first_number(row, "rate_multiplier") or 1.0,
            "platform": _first_text(row, "platform"),
            "user_ratio": user_ratio,
            "peak_ratio": _first_number(row, "peak_rate_multiplier") if peak_enabled else None,
            "peak_start": _first_text(row, "peak_start") if peak_enabled else None,
            "peak_end": _first_text(row, "peak_end") if peak_enabled else None,
            "extra": {key: value for key, value in extra.items() if value is not None},
        }
    return groups


def _pricing_from_plaza(plaza: dict[str, Any]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Flatten model plaza groups into per-model pricing rows plus group data.

    One row per (model, platform): prices come from the group with the lowest
    effective multiplier (deterministic, cheapest, closest to the official
    card), while `enable_groups` lists every group offering the model. Prices
    are USD per 1M tokens (base, before group/user multipliers).
    """
    data = Sub2APIClient._extract_data(plaza)
    groups_raw = data.get("groups") if isinstance(data, dict) else None
    if not isinstance(groups_raw, list):
        return [], {}

    best: dict[tuple[str, str], dict[str, Any]] = {}
    model_groups: dict[tuple[str, str], set[str]] = {}
    official: dict[tuple[str, str], dict[str, Any]] = {}

    for group_row in groups_raw:
        if not isinstance(group_row, dict):
            continue
        group_name = _first_text(group_row, "name") or ""
        effective = _first_number(group_row, "user_rate_multiplier") or _first_number(
            group_row, "rate_multiplier"
        ) or 1.0
        models = group_row.get("models") or []
        if not isinstance(models, list):
            continue
        long_context = bool(group_row.get("long_context_pricing_enabled"))

        for model_row in models:
            if not isinstance(model_row, dict):
                continue
            model_name = _first_text(model_row, "name")
            platform = _first_text(model_row, "platform") or ""
            if not model_name:
                continue
            key = (model_name, platform)
            model_groups.setdefault(key, set()).add(group_name)

            pricing = model_row.get("pricing") if isinstance(model_row.get("pricing"), dict) else None
            if pricing is None:
                continue
            candidate = _pricing_row_from_plaza_model(model_name, platform, group_name, pricing, model_row, long_context)
            current = best.get(key)
            if current is None or effective < current["_effective_rate"]:
                candidate["_effective_rate"] = effective
                best[key] = candidate

            official_pricing = model_row.get("official_pricing")
            if isinstance(official_pricing, dict) and key not in official:
                official[key] = official_pricing

    rows: list[dict[str, Any]] = []
    for (model_name, platform), row in best.items():
        row.pop("_effective_rate", None)
        row["enable_groups"] = sorted(model_groups.get((model_name, platform), set()))
        official_prices = official.get((model_name, platform)) or {}
        row["official_price_input"] = _usd_per_token_to_per_million(official_prices.get("input_price"))
        rows.append(row)

    rows.sort(key=lambda item: str(item.get("model_name")))
    return rows, _groups_from_plaza(plaza)


def _pricing_row_from_plaza_model(
    model_name: str,
    platform: str,
    group_name: str,
    pricing: dict[str, Any],
    model_row: dict[str, Any],
    long_context_enabled: bool,
) -> dict[str, Any]:
    """Build one normalized pricing row from a plaza model entry."""
    billing_mode = _first_text(pricing, "billing_mode") or "token"
    intervals_raw = pricing.get("intervals") if isinstance(pricing.get("intervals"), list) else []

    tiers: list[dict[str, Any]] = []
    for interval in intervals_raw:
        if not isinstance(interval, dict):
            continue
        tiers.append(
            {
                "label": interval.get("tier_label") or None,
                "min_tokens": _coerce_int(interval.get("min_tokens"), 0),
                "max_tokens": _coerce_int(interval.get("max_tokens")),
                "input_price": _usd_per_token_to_per_million(
                    interval.get("input_price", interval.get("input_multiplier"))
                ),
                "output_price": _usd_per_token_to_per_million(
                    interval.get("output_price", interval.get("output_multiplier"))
                ),
                "cache_read_price": _usd_per_token_to_per_million(
                    interval.get("cache_read_price", interval.get("cache_read_multiplier"))
                ),
                "cache_write_price": _usd_per_token_to_per_million(
                    interval.get("cache_write_price", interval.get("cache_write_multiplier"))
                ),
                "cache_write_1h_price": _usd_per_token_to_per_million(interval.get("cache_write_1h_price")),
                "per_request_price": interval.get("per_request_price"),
            }
        )
    tiers = [tier for tier in tiers if any(tier.get(key) is not None for key in (
        "input_price", "output_price", "cache_read_price", "cache_write_price", "per_request_price"
    ))]

    per_request = _coerce_float(pricing.get("per_request_price"))
    is_per_request = billing_mode in {"per_request", "image", "video"} or (
        per_request is not None and not tiers
    )

    row: dict[str, Any] = {
        "model_name": model_name,
        "vendor_id": None,
        "vendor_name": platform or None,
        "quota_type": 1 if is_per_request else 0,
        # Sub2API rows carry explicit USD prices; NewAPI-style ratio fields stay 0.
        "model_ratio": 0,
        "model_price": per_request if is_per_request else 0,
        "completion_ratio": 0,
        "enable_groups": [],
        "supported_endpoint_types": [],
        "source": "sub2api",
        "platform": platform or None,
        "billing_mode": billing_mode,
        "long_context_pricing_enabled": long_context_enabled,
        "long_context_basis": model_row.get("long_context_basis") or None,
        "price_input": _usd_per_token_to_per_million(pricing.get("input_price")),
        "price_output": _usd_per_token_to_per_million(pricing.get("output_price")),
        "price_cache_read": _usd_per_token_to_per_million(pricing.get("cache_read_price")),
        "price_cache_write": _usd_per_token_to_per_million(pricing.get("cache_write_price")),
        "price_cache_write_1h": _usd_per_token_to_per_million(pricing.get("cache_write_1h_price")),
        "price_per_request": per_request if is_per_request else None,
        "tiers": tiers or None,
        "representative_group": group_name,
    }

    time_pricing = model_row.get("time_pricing")
    if isinstance(time_pricing, dict) and isinstance(time_pricing.get("periods"), list):
        periods = [
            {
                "start_time": period.get("start_time"),
                "end_time": period.get("end_time"),
                "multiplier": _coerce_float(period.get("multiplier")),
            }
            for period in time_pricing.get("periods", [])
            if isinstance(period, dict)
        ]
        periods = [period for period in periods if period["multiplier"] is not None]
        if periods:
            row["time_pricing"] = {
                "timezone": time_pricing.get("timezone"),
                "weekdays_only": bool(time_pricing.get("weekdays_only")),
                "periods": periods,
            }
    return row


def _extract_user_id(payload: object) -> int | None:
    if not isinstance(payload, dict):
        return None
    for key in ("id", "user_id", "uid"):
        value = payload.get(key)
        parsed = _coerce_int(value)
        if parsed is not None and parsed > 0:
            return parsed
    return None


def _extract_error_message(payload: object) -> str | None:
    """Read common error message fields from Sub2API responses."""
    if isinstance(payload, dict):
        message = _first_text(payload, "message", "detail", "error_description")
        if message:
            return message
        error_payload = payload.get("error")
        if isinstance(error_payload, dict):
            return _first_text(error_payload, "message", "detail", "localized_message")
        if isinstance(error_payload, str) and error_payload.strip():
            return error_payload.strip()
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


def _extract_items(payload: object) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("trend", "items", "list", "data", "records", "models", "rows", "result"):
            value = payload.get(key)
            if isinstance(value, list):
                return [item for item in value if isinstance(item, dict)]
    return []


def _normalize_groups(available: object, rates: object) -> dict[str, Any]:
    """Legacy group normalization for Sub2API sites without the model plaza."""
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
        peak_enabled = bool(row.get("peak_rate_enabled"))
        groups[group_name] = {
            "desc": _first_text(row, "description", "desc", "display_name"),
            "ratio": _first_number(row, "rate_multiplier", "ratio", "rate", "multiplier") or rate_map.get(group_name, 1.0),
            "platform": _first_text(row, "platform"),
            "user_ratio": rate_map.get(group_name),
            "peak_ratio": _first_number(row, "peak_rate_multiplier") if peak_enabled else None,
            "peak_start": _first_text(row, "peak_start") if peak_enabled else None,
            "peak_end": _first_text(row, "peak_end") if peak_enabled else None,
            "extra": {
                "group_id": _coerce_int(row.get("id")),
                "subscription_type": row.get("subscription_type") or None,
                "is_exclusive": bool(row.get("is_exclusive")),
                "long_context_pricing_enabled": bool(row.get("long_context_pricing_enabled")),
            },
        }

    for group_name, ratio in rate_map.items():
        groups.setdefault(group_name, {"desc": None, "ratio": ratio})

    return groups


def _normalize_daily_usage_row(row: dict[str, Any]) -> dict[str, Any]:
    """One trend row → shared daily usage shape (quota in micro-USD)."""
    timestamp = _first_timestamp(row)
    used_usd = _first_number(row, "actual_cost", "used_quota", "quota", "cost", "total_cost", "amount")
    return {
        "created_at": timestamp,
        "count": int(round(_first_number(row, "requests", "request_count", "total_requests", "count") or 0)),
        "quota": _usd_to_micro(used_usd or 0.0),
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


def _resolve_timezone(timezone_name: str):
    """Resolve an IANA timezone string, falling back to UTC."""
    from zoneinfo import ZoneInfo

    try:
        return ZoneInfo(timezone_name)
    except Exception:
        return timezone.utc
