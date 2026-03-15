"""Pricing model response schemas."""

from datetime import datetime

from pydantic import BaseModel


class PricingModelItem(BaseModel):
    """Flattened pricing model row."""

    id: int
    instance_id: int
    instance_name: str
    model_name: str
    vendor_id: int | None = None
    vendor_name: str | None = None
    quota_type: int
    model_ratio: float
    model_price: float
    completion_ratio: float
    enable_groups: list[str]
    supported_endpoint_types: list[str]
    snapshot_at: datetime


class PricingModelListResponse(BaseModel):
    """Paginated response for pricing model queries."""

    total: int
    offset: int
    limit: int
    items: list[PricingModelItem]

