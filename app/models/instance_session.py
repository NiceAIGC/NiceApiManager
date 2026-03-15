"""Cached remote login session model."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING

from sqlalchemy import DateTime, ForeignKey, Integer, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class InstanceSession(Base):
    """Stores the reusable session cookie and remote user ID for one instance."""

    __tablename__ = "instance_sessions"

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), unique=True)
    remote_user_id: Mapped[int] = mapped_column(Integer, nullable=False)
    cookie_value: Mapped[str] = mapped_column(Text, nullable=False)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    instance: Mapped[Instance] = relationship(back_populates="session")

