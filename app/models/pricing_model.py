"""Current pricing model snapshot per instance."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class PricingModel(Base):
    """Locally stored pricing metadata from `/api/pricing`."""

    __tablename__ = "pricing_models"
    __table_args__ = (UniqueConstraint("instance_id", "model_name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    instance_id: Mapped[int] = mapped_column(ForeignKey("instances.id", ondelete="CASCADE"), index=True)
    model_name: Mapped[str] = mapped_column(String(255), nullable=False, index=True)
    vendor_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    vendor_name: Mapped[str | None] = mapped_column(String(100), nullable=True)
    quota_type: Mapped[int] = mapped_column(Integer, nullable=False)
    model_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    model_price: Mapped[float] = mapped_column(Float, nullable=False)
    completion_ratio: Mapped[float] = mapped_column(Float, nullable=False)
    enable_groups_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    supported_endpoint_types_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    instance: Mapped[Instance] = relationship(back_populates="pricing_models")

