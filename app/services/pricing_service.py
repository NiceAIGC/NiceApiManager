"""Pricing model query service."""

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.models import Instance, PricingModel
from app.schemas.pricing import PricingModelItem, PricingModelListResponse


def list_pricing_models(
    db: Session,
    instance_id: int | None = None,
    search: str | None = None,
    group_name: str | None = None,
    tag: str | None = None,
    offset: int = 0,
    limit: int = 100,
) -> PricingModelListResponse:
    """Return locally stored pricing models with optional filters."""
    stmt = select(PricingModel, Instance.name).join(Instance, Instance.id == PricingModel.instance_id)
    count_stmt = (
        select(func.count(PricingModel.id))
        .select_from(PricingModel)
        .join(Instance, Instance.id == PricingModel.instance_id)
    )

    if instance_id is not None:
        stmt = stmt.where(PricingModel.instance_id == instance_id)
        count_stmt = count_stmt.where(PricingModel.instance_id == instance_id)

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(PricingModel.model_name.ilike(pattern))
        count_stmt = count_stmt.where(PricingModel.model_name.ilike(pattern))

    if group_name:
        # Stored as JSON array. SQLite supports LIKE filtering against serialized values well enough here.
        pattern = f'%"{group_name}"%'
        stmt = stmt.where(cast(PricingModel.enable_groups_json, String).like(pattern))
        count_stmt = count_stmt.where(cast(PricingModel.enable_groups_json, String).like(pattern))

    if tag:
        pattern = f'%"{tag.strip()}"%'
        stmt = stmt.where(cast(Instance.tags_json, String).like(pattern))
        count_stmt = count_stmt.where(cast(Instance.tags_json, String).like(pattern))

    stmt = stmt.order_by(PricingModel.instance_id.asc(), PricingModel.model_name.asc()).offset(offset).limit(limit)

    rows = db.execute(stmt).all()
    total = db.scalar(count_stmt) or 0

    return PricingModelListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[
            PricingModelItem(
                id=model.id,
                instance_id=model.instance_id,
                instance_name=instance_name,
                model_name=model.model_name,
                vendor_id=model.vendor_id,
                vendor_name=model.vendor_name,
                quota_type=model.quota_type,
                model_ratio=model.model_ratio,
                model_price=model.model_price,
                completion_ratio=model.completion_ratio,
                enable_groups=model.enable_groups_json or [],
                supported_endpoint_types=model.supported_endpoint_types_json or [],
                snapshot_at=model.snapshot_at,
            )
            for model, instance_name in rows
        ],
    )
