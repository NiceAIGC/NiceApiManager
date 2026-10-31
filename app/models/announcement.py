"""Upstream announcements synced from NewAPI / Sub2API sites."""

from __future__ import annotations

from datetime import datetime

from sqlalchemy import Boolean, DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core.time import utcnow
from app.models.base import Base


class Announcement(Base):
    """One upstream announcement; first sync only establishes a baseline."""

    __tablename__ = "announcements"
    __table_args__ = (UniqueConstraint("instance_id", "source_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    # 上游公告 id；缺失时用内容指纹代替。
    source_id: Mapped[str] = mapped_column(String(128), nullable=False)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False, default="")
    published_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    synced_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)
    notified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
