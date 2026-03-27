"""Configured NewAPI instance model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import JSON, Boolean, DateTime, Float, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.daily_usage_stat import DailyUsageStat
    from app.models.group_ratio import GroupRatio
    from app.models.instance_session import InstanceSession
    from app.models.pricing_model import PricingModel
    from app.models.sync_run import SyncRun
    from app.models.user_snapshot import UserSnapshot


class Instance(Base):
    """A remote NewAPI site configured for aggregation."""

    __tablename__ = "instances"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, index=True)
    base_url: Mapped[str] = mapped_column(String(255))
    program_type: Mapped[str] = mapped_column(String(16), default="newapi", nullable=False)
    username: Mapped[str] = mapped_column(String(100), default="", nullable=False)
    password: Mapped[str] = mapped_column(Text)
    remote_user_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    access_token: Mapped[str | None] = mapped_column(Text, nullable=True)
    proxy_mode: Mapped[str] = mapped_column(String(16), default="direct", nullable=False)
    socks5_proxy_url: Mapped[str | None] = mapped_column(String(255), nullable=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    billing_mode: Mapped[str] = mapped_column(String(16), default="prepaid", nullable=False)
    priority: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    sync_interval_minutes: Mapped[int] = mapped_column(Integer, default=120, nullable=False)
    tags_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    quota_per_unit: Mapped[float | None] = mapped_column(Float, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_health_status: Mapped[str] = mapped_column(String(32), default="unknown", nullable=False)
    last_health_error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )

    session: Mapped[InstanceSession | None] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
        uselist=False,
    )
    user_snapshots: Mapped[list[UserSnapshot]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
    daily_usage_stats: Mapped[list[DailyUsageStat]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
    group_ratios: Mapped[list[GroupRatio]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
    pricing_models: Mapped[list[PricingModel]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
    sync_runs: Mapped[list[SyncRun]] = relationship(
        back_populates="instance",
        cascade="all, delete-orphan",
    )
