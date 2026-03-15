"""Historical user quota snapshots."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import BigInteger, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class UserSnapshot(Base):
    """Point-in-time view of remote user quota and usage counters."""

    __tablename__ = "user_snapshots"

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    quota: Mapped[int] = mapped_column(BigInteger, nullable=False)
    used_quota: Mapped[int] = mapped_column(BigInteger, nullable=False)
    request_count: Mapped[int] = mapped_column(Integer, nullable=False)
    group_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    instance: Mapped[Instance] = relationship(back_populates="user_snapshots")

