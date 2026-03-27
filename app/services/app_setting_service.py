"""Helpers for persisted runtime application settings."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AppSetting
from app.schemas.app_setting import AppSettingsResponse, AppSettingsUpdateRequest
from app.services.proxy_utils import normalize_socks5_proxy_url


env_settings = get_settings()
DEFAULT_SYNC_MAX_WORKERS = 5
DEFAULT_SYNC_HISTORY_LOOKBACK_DAYS = 30
DEFAULT_SYNC_INTERVAL_MINUTES = 120


@dataclass(frozen=True)
class RuntimeAppSettings:
    """Effective runtime settings after applying DB overrides over env defaults."""

    sync_max_workers: int
    request_timeout: float
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int
    default_sync_interval_minutes: int
    shared_socks5_proxy_url: str | None


def get_app_setting_record(db: Session) -> AppSetting | None:
    """Return the singleton settings row when it exists."""
    return db.scalar(select(AppSetting).order_by(AppSetting.id.asc()).limit(1))


def get_runtime_app_settings(db: Session) -> RuntimeAppSettings:
    """Return the effective runtime settings used across services."""
    row = get_app_setting_record(db)
    return RuntimeAppSettings(
        sync_max_workers=_coerce_int(
            row.sync_max_workers if row else None,
            default=DEFAULT_SYNC_MAX_WORKERS,
            minimum=1,
            maximum=32,
        ),
        request_timeout=_coerce_float(
            row.request_timeout if row else None,
            default=env_settings.request_timeout,
            minimum=0.1,
            maximum=300.0,
        ),
        sync_verify_ssl=env_settings.sync_verify_ssl if row is None or row.sync_verify_ssl is None else row.sync_verify_ssl,
        scheduler_timezone=(
            env_settings.scheduler_timezone
            if row is None or not row.scheduler_timezone
            else row.scheduler_timezone.strip()
        ),
        sync_history_lookback_days=_coerce_int(
            row.sync_history_lookback_days if row else None,
            default=DEFAULT_SYNC_HISTORY_LOOKBACK_DAYS,
            minimum=1,
            maximum=365,
        ),
        default_sync_interval_minutes=_coerce_int(
            row.default_sync_interval_minutes if row else None,
            default=DEFAULT_SYNC_INTERVAL_MINUTES,
            minimum=5,
            maximum=10080,
        ),
        shared_socks5_proxy_url=normalize_socks5_proxy_url(row.shared_socks5_proxy_url if row else None),
    )


def build_app_settings_response(db: Session) -> AppSettingsResponse:
    """Serialize the effective settings for API callers."""
    row = get_app_setting_record(db)
    runtime = get_runtime_app_settings(db)
    return AppSettingsResponse(
        sync_max_workers=runtime.sync_max_workers,
        request_timeout=runtime.request_timeout,
        sync_verify_ssl=runtime.sync_verify_ssl,
        scheduler_timezone=runtime.scheduler_timezone,
        sync_history_lookback_days=runtime.sync_history_lookback_days,
        default_sync_interval_minutes=runtime.default_sync_interval_minutes,
        shared_socks5_proxy_url=runtime.shared_socks5_proxy_url,
        created_at=row.created_at if row else None,
        updated_at=row.updated_at if row else None,
    )


def update_app_settings(db: Session, payload: AppSettingsUpdateRequest) -> AppSettingsResponse:
    """Persist runtime settings in the singleton row and return the effective view."""
    row = get_app_setting_record(db)
    if row is None:
        row = AppSetting()
        db.add(row)

    row.sync_max_workers = payload.sync_max_workers
    row.request_timeout = payload.request_timeout
    row.sync_verify_ssl = payload.sync_verify_ssl
    row.scheduler_timezone = payload.scheduler_timezone.strip()
    row.sync_history_lookback_days = payload.sync_history_lookback_days
    row.default_sync_interval_minutes = payload.default_sync_interval_minutes
    row.shared_socks5_proxy_url = normalize_socks5_proxy_url(payload.shared_socks5_proxy_url)
    db.commit()
    db.refresh(row)

    return AppSettingsResponse(
        sync_max_workers=row.sync_max_workers,
        request_timeout=row.request_timeout,
        sync_verify_ssl=row.sync_verify_ssl,
        scheduler_timezone=row.scheduler_timezone,
        sync_history_lookback_days=row.sync_history_lookback_days,
        default_sync_interval_minutes=row.default_sync_interval_minutes,
        shared_socks5_proxy_url=row.shared_socks5_proxy_url,
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _coerce_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    """Convert persisted values into a bounded integer."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _coerce_float(value: object, *, default: float, minimum: float, maximum: float) -> float:
    """Convert persisted values into a bounded float."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))
