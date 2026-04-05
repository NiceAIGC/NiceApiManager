"""Persisted state for deduplicating and recovering notification rules."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import DateTime, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class NotificationRuleState(Base):
    """One state row per rule target for cooldown, repeats, and recovery."""

    __tablename__ = "notification_rule_states"
    __table_args__ = (
        UniqueConstraint("rule_type", "rule_id", "target_key", name="uq_notification_rule_state"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    rule_type: Mapped[str] = mapped_column(String(32), index=True, nullable=False)
    rule_id: Mapped[str] = mapped_column(String(64), index=True, nullable=False)
    target_key: Mapped[str] = mapped_column(String(128), nullable=False)
    status: Mapped[str] = mapped_column(String(16), default="normal", nullable=False)
    consecutive_hits: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_value: Mapped[str | None] = mapped_column(String(255), nullable=True)
    last_triggered_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_resolved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    last_evaluated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
