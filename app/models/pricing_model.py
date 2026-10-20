"""Current pricing model snapshot per instance."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any

from sqlalchemy import DateTime, Float, ForeignKey, Integer, JSON, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.time import utcnow
from app.models.base import Base

if TYPE_CHECKING:
    from app.models.instance import Instance


class PricingModel(Base):
    """Locally stored pricing metadata from NewAPI `/api/pricing` or Sub2API model plaza.

    Normalized price columns are always USD per 1M tokens (`price_per_request`
    is USD per request) so different upstream programs compare directly. Raw
    upstream fields (ratios, prices, expressions) are kept alongside for
    fidelity and ratio-style display.
    """

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
    cache_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    create_cache_ratio: Mapped[float | None] = mapped_column(Float, nullable=True)
    billing_mode: Mapped[str | None] = mapped_column(String(32), nullable=True)
    # Raw NewAPI tiered billing expression, kept verbatim for auditing.
    billing_expr: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Parsed tiers from `billing_expr` (see services/billing_expr.py).
    tiers_json: Mapped[list[dict[str, Any]] | None] = mapped_column(JSON, nullable=True)
    # Sub2API time-based multiplier schedule:
    # {timezone, weekdays_only, periods: [{start_time, end_time, multiplier}]}
    time_pricing_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Normalized USD-per-1M-token prices (first/base tier for tiered models).
    price_input: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_output: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cache_read: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cache_write: Mapped[float | None] = mapped_column(Float, nullable=True)
    price_cache_write_1h: Mapped[float | None] = mapped_column(Float, nullable=True)
    # USD per request for fixed/per-request billed models.
    price_per_request: Mapped[float | None] = mapped_column(Float, nullable=True)
    enable_groups_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    supported_endpoint_types_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    snapshot_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, index=True)

    instance: Mapped[Instance] = relationship(back_populates="pricing_models")
