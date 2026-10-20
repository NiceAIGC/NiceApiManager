"""Current group ratio snapshot per instance plus user-defined group labels."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import (
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    JSON,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class GroupRatio(Base):
    """Current group ratio values for one instance.

    `ratio` is the effective consumption multiplier exposed by the upstream
    program. Sub2API-specific details (platform, user-specific multiplier,
    peak window) get first-class nullable columns; everything else that is
    program specific lives in `extra_json`.
    """

    __tablename__ = "group_ratios"
    __table_args__ = (UniqueConstraint("instance_id", "group_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    group_name: Mapped[str] = mapped_column(String(100), nullable=False)
    group_desc: Mapped[str | None] = mapped_column(String(255), nullable=True)
    ratio: Mapped[float] = mapped_column(Float, nullable=False)
    # Sub2API platform scope (anthropic/openai/gemini/...); NULL for NewAPI.
    platform: Mapped[str | None] = mapped_column(String(64), nullable=True)
    # Sub2API user-specific multiplier override for this group.
    user_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    # Sub2API peak/off-peak window and its multiplier.
    peak_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    peak_start: Mapped[str | None] = mapped_column(String(16), nullable=True)
    peak_end: Mapped[str | None] = mapped_column(String(16), nullable=True)
    # Other program-specific group attributes (subscription type, exclusivity...).
    extra_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    instance: Mapped[Instance] = relationship(back_populates="group_ratios")


class GroupLabel(Base):
    """A user-defined label used to compare the same logical group across instances."""

    __tablename__ = "group_labels"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    color: Mapped[str | None] = mapped_column(String(32), nullable=True)
    remark: Mapped[str | None] = mapped_column(String(255), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    assignments: Mapped[list[GroupLabelAssignment]] = relationship(
        back_populates="label",
        cascade="all, delete-orphan",
    )


class GroupLabelAssignment(Base):
    """Maps one group name (across every instance) to one label."""

    __tablename__ = "group_label_assignments"
    __table_args__ = (UniqueConstraint("label_id", "group_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    label_id: Mapped[int] = mapped_column(
        ForeignKey("group_labels.id", ondelete="CASCADE"),
        index=True,
    )
    group_name: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    enabled: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)

    label: Mapped[GroupLabel] = relationship(back_populates="assignments")
