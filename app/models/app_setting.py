"""Runtime application settings persisted in the database."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class AppSetting(Base):
    """Singleton-style row for mutable runtime settings."""

    __tablename__ = "app_settings"

    id: Mapped[int] = mapped_column(primary_key=True)
    auth_password_hash: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_max_workers: Mapped[int | None] = mapped_column(Integer, nullable=True)
    request_timeout: Mapped[float | None] = mapped_column(Float, nullable=True)
    sync_verify_ssl: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    scheduler_timezone: Mapped[str | None] = mapped_column(String(64), nullable=True)
    sync_history_lookback_days: Mapped[int | None] = mapped_column(Integer, nullable=True)
    default_sync_interval_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    shared_socks5_proxy_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    notification_enabled: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    notification_check_interval_minutes: Mapped[int | None] = mapped_column(Integer, nullable=True)
    notification_channels_json: Mapped[list[dict[str, object]] | None] = mapped_column(JSON, nullable=True)
    notification_rules_json: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    notification_last_scan_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
