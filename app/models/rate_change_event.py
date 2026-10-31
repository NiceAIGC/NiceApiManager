"""Detected group-rate change events produced during instance sync."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class RateChangeEvent(Base):
    """One detected ratio change (added / removed / changed) for a group."""

    __tablename__ = "rate_change_events"

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    group_name: Mapped[str] = mapped_column(String(100), nullable=False)
    platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # added: 新出现的分组；removed: 消失的分组；changed: 倍率数值变动。
    change_type: Mapped[str] = mapped_column(String(16), nullable=False)
    old_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    new_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    change_percent: Mapped[float | None] = mapped_column(Float, nullable=True)
    notified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    detected_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
