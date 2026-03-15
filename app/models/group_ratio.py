"""Current group ratio snapshot per instance."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, Float, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class GroupRatio(Base):
    """Current group ratio values for one instance."""

    __tablename__ = "group_ratios"
    __table_args__ = (UniqueConstraint("instance_id", "group_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    group_name: Mapped[str] = mapped_column(String(100), nullable=False)
    group_desc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ratio: Mapped[float] = mapped_column(Float, nullable=False)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    instance: Mapped[Instance] = relationship(back_populates="group_ratios")

