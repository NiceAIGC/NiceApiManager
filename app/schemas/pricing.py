"""Pricing model response schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class PricingModelItem(BaseModel):
    """Flattened pricing model row."""

    id: int
    instance_id: int
    instance_name: str
    instance_program: str = "newapi"
    model_name: str
    vendor_id: int | None = None
    vendor_name: str | None = None
    quota_type: int
    model_ratio: float
    model_price: float
    completion_ratio: float
    cache_ratio: float | None = None
    create_cache_ratio: float | None = None
    billing_mode: str | None = None
    billing_expr: str | None = None
    tiers: list[dict[str, Any]] | None = None
    time_pricing: dict[str, Any] | None = None
    # Normalized USD-per-1M-token prices (first/base tier for tiered models).
    price_input: float | None = None
    price_output: float | None = None
    price_cache_read: float | None = None
    price_cache_write: float | None = None
    price_cache_write_1h: float | None = None
    # USD per request for fixed/per-request billed models.
    price_per_request: float | None = None
    # Source-specific extras (image/audio ratios, description, reasoning
    # multipliers, official reference price, long-context basis...).
    extra: dict[str, Any] | None = None
    enable_groups: list[str]
    supported_endpoint_types: list[str]
    snapshot_at: datetime


class PricingModelListResponse(BaseModel):
    """Paginated response for pricing model queries."""

    total: int
    offset: int
    limit: int
    items: list[PricingModelItem]


class PricingCompareEntry(BaseModel):
    """One instance's price for one model inside a comparison row."""

    instance_id: int
    pricing_model_id: int | None = None
    quota_type: int = 0
    billing_mode: str | None = None
    tier_count: int = 0
    has_time_pricing: bool = False
    model_ratio: float = 0
    completion_ratio: float = 0
    price_input: float | None = None
    price_output: float | None = None
    price_cache_read: float | None = None
    price_per_request: float | None = None
    # Lowest group ratio among the groups this model is enabled for.
    min_group_ratio: float | None = None
    # price_input × min_group_ratio — the cheapest reachable input price.
    effective_input: float | None = None


class PricingCompareModelRow(BaseModel):
    """Cross-instance price comparison for one model name."""

    model_name: str
    vendor_name: str | None = None
    entries: list[PricingCompareEntry]
    best_instance_id: int | None = None
    best_input_price: float | None = None
    worst_input_price: float | None = None


class PricingCompareResponse(BaseModel):
    """Response for the pricing comparison endpoint."""

    instances: list[dict[str, Any]]
    models: list[PricingCompareModelRow]
    total: int
    offset: int
    limit: int


class PricingFacetResponse(BaseModel):
    """Aggregated filter options for the pricing page."""

    vendors: list[str]
    groups: list[str]
    endpoints: list[str]
    model_count: int
    instance_count: int
