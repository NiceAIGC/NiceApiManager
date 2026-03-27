"""Schemas for runtime-configurable application settings."""

from __future__ import annotations

from datetime import datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator


class AppSettingsResponse(BaseModel):
    """Effective runtime settings returned to the admin UI."""

    sync_max_workers: int = Field(ge=1, le=32)
    request_timeout: float = Field(gt=0, le=300)
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int = Field(ge=1, le=365)
    default_sync_interval_minutes: int = Field(ge=5, le=10080)
    shared_socks5_proxy_url: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("scheduler_timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        """Reject invalid IANA timezone names."""
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("无效时区，请填写标准 IANA 时区名，例如 Asia/Shanghai。") from exc
        return value


class AppSettingsUpdateRequest(BaseModel):
    """Payload used to update mutable runtime settings."""

    sync_max_workers: int = Field(ge=1, le=32)
    request_timeout: float = Field(gt=0, le=300)
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int = Field(ge=1, le=365)
    default_sync_interval_minutes: int = Field(ge=5, le=10080)
    shared_socks5_proxy_url: str | None = None

    @field_validator("scheduler_timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        """Reject invalid IANA timezone names."""
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("无效时区，请填写标准 IANA 时区名，例如 Asia/Shanghai。") from exc
        return value
