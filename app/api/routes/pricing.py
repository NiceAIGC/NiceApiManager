"""Pricing model aggregation routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.pricing import (
    PricingCompareResponse,
    PricingFacetResponse,
    PricingModelListResponse,
)
from app.services.pricing_service import compare_pricing_models, list_pricing_models, pricing_facets


router = APIRouter()


@router.get("/pricing/models", response_model=PricingModelListResponse)
def get_pricing_models(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    search: str | None = Query(default=None, description="Filter by model/vendor name substring."),
    group_name: str | None = Query(default=None, description="Filter models enabled for a group."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    vendor: str | None = Query(default=None, description="Filter by vendor name substring."),
    endpoint_type: str | None = Query(default=None, description="Filter by supported endpoint type."),
    billing_kind: str | None = Query(
        default=None,
        description="One of token/fixed/tiered/time.",
    ),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> PricingModelListResponse:
    """Return pricing models stored locally from the latest sync."""
    return list_pricing_models(
        db,
        instance_id=instance_id,
        search=search,
        group_name=group_name,
        tag=tag,
        vendor=vendor,
        endpoint_type=endpoint_type,
        billing_kind=billing_kind,
        offset=offset,
        limit=limit,
    )


@router.get("/pricing/compare", response_model=PricingCompareResponse)
def get_pricing_comparison(
    search: str | None = Query(default=None, description="Filter by model/vendor name substring."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    instance_ids: str | None = Query(default=None, description="Comma-separated instance IDs."),
    group_name: str | None = Query(default=None, description="Filter models enabled for a group."),
    vendor: str | None = Query(default=None, description="Filter by vendor name substring."),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=500),
    db: Session = Depends(get_db),
) -> PricingCompareResponse:
    """Compare normalized model prices across instances."""
    parsed_ids: list[int] | None = None
    if instance_ids:
        try:
            parsed_ids = [int(part) for part in instance_ids.split(",") if part.strip()]
        except ValueError:
            parsed_ids = []
        parsed_ids = parsed_ids or None
    return compare_pricing_models(
        db,
        search=search,
        tag=tag,
        instance_ids=parsed_ids,
        group_name=group_name,
        vendor=vendor,
        offset=offset,
        limit=limit,
    )


@router.get("/pricing/facets", response_model=PricingFacetResponse)
def get_pricing_facets(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    db: Session = Depends(get_db),
) -> PricingFacetResponse:
    """Return aggregated filter options for the pricing page."""
    return pricing_facets(db, instance_id=instance_id, tag=tag)
