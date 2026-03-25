"""Daily usage totals aggregated from remote consumption logs."""

from __future__ import annotations

from datetime import date, datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, Date, DateTime, Float, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class DailyUsageStat(Base):
    """Daily request and usage totals for one instance."""

    __tablename__ = "daily_usage_stats"
    __table_args__ = (
        UniqueConstraint("instance_id", "usage_date", name="uq_daily_usage_stats_instance_date"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    usage_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    used_quota: Mapped[int] = mapped_column(BigInteger, nullable=False, default=0)
    used_display_amount: Mapped[float] = mapped_column(Float, nullable=False, default=0)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    instance: Mapped[Instance] = relationship(back_populates="daily_usage_stats")
