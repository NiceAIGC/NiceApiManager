"""Pricing model aggregation routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.pricing import PricingModelListResponse
from app.services.pricing_service import list_pricing_models


router = APIRouter()


@router.get("/pricing/models", response_model=PricingModelListResponse)
def get_pricing_models(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    search: str | None = Query(default=None, description="Filter by model name substring."),
    group_name: str | None = Query(default=None, description="Filter models enabled for a group."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
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
        offset=offset,
        limit=limit,
    )
