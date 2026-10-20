"""Pricing model query service."""

from __future__ import annotations

from sqlalchemy import String, and_, cast, func, or_, select
from sqlalchemy.orm import Session

from app.models import GroupRatio, Instance, PricingModel
from app.schemas.pricing import (
    PricingCompareEntry,
    PricingCompareModelRow,
    PricingCompareResponse,
    PricingFacetResponse,
    PricingModelItem,
    PricingModelListResponse,
)

_TIERED_BILLING_MODES = {"tiered_expr"}


def list_pricing_models(
    db: Session,
    instance_id: int | None = None,
    search: str | None = None,
    group_name: str | None = None,
    tag: str | None = None,
    vendor: str | None = None,
    billing_kind: str | None = None,
    endpoint_type: str | None = None,
    offset: int = 0,
    limit: int = 100,
) -> PricingModelListResponse:
    """Return locally stored pricing models with optional filters."""
    stmt = (
        select(PricingModel, Instance.name, Instance.program_type)
        .join(Instance, Instance.id == PricingModel.instance_id)
    )
    count_stmt = (
        select(func.count(PricingModel.id))
        .select_from(PricingModel)
        .join(Instance, Instance.id == PricingModel.instance_id)
    )

    filters = _pricing_filters(
        instance_id=instance_id,
        search=search,
        group_name=group_name,
        tag=tag,
        vendor=vendor,
        billing_kind=billing_kind,
        endpoint_type=endpoint_type,
    )
    if filters:
        stmt = stmt.where(*filters)
        count_stmt = count_stmt.where(*filters)

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
                instance_program=program_type,
                model_name=model.model_name,
                vendor_id=model.vendor_id,
                vendor_name=model.vendor_name,
                quota_type=model.quota_type,
                model_ratio=model.model_ratio,
                model_price=model.model_price,
                completion_ratio=model.completion_ratio,
                cache_ratio=model.cache_ratio,
                create_cache_ratio=model.create_cache_ratio,
                billing_mode=model.billing_mode,
                billing_expr=model.billing_expr,
                tiers=model.tiers_json or None,
                time_pricing=model.time_pricing_json or None,
                price_input=model.price_input,
                price_output=model.price_output,
                price_cache_read=model.price_cache_read,
                price_cache_write=model.price_cache_write,
                price_cache_write_1h=model.price_cache_write_1h,
                price_per_request=model.price_per_request,
                enable_groups=model.enable_groups_json or [],
                supported_endpoint_types=model.supported_endpoint_types_json or [],
                snapshot_at=model.snapshot_at,
            )
            for model, instance_name, program_type in rows
        ],
    )


def pricing_facets(
    db: Session,
    instance_id: int | None = None,
    tag: str | None = None,
) -> PricingFacetResponse:
    """Return aggregated filter options computed from stored pricing rows."""
    filters = _pricing_filters(instance_id=instance_id, tag=tag)
    base = select(PricingModel).join(Instance, Instance.id == PricingModel.instance_id)
    if filters:
        base = base.where(*filters)
    vendors_stmt = (
        select(PricingModel.vendor_name)
        .distinct()
        .join(Instance, Instance.id == PricingModel.instance_id)
        .where(PricingModel.vendor_name.is_not(None))
    )
    if filters:
        vendors_stmt = vendors_stmt.where(*filters)
    vendors = sorted(
        value
        for (value,) in db.execute(vendors_stmt).all()
        if value
    )
    groups: set[str] = set()
    endpoints: set[str] = set()
    instance_ids: set[int] = set()
    model_count = 0
    for row in db.execute(base).scalars():
        model_count += 1
        instance_ids.add(row.instance_id)
        groups.update(row.enable_groups_json or [])
        endpoints.update(row.supported_endpoint_types_json or [])

    return PricingFacetResponse(
        vendors=vendors,
        groups=sorted(groups),
        endpoints=sorted(endpoints),
        model_count=model_count,
        instance_count=len(instance_ids),
    )


def compare_pricing_models(
    db: Session,
    *,
    search: str | None = None,
    tag: str | None = None,
    instance_ids: list[int] | None = None,
    group_name: str | None = None,
    vendor: str | None = None,
    offset: int = 0,
    limit: int = 100,
) -> PricingCompareResponse:
    """Compare normalized prices for one model across instances."""
    filters = _pricing_filters(
        search=search,
        group_name=group_name,
        tag=tag,
        vendor=vendor,
    )
    if instance_ids:
        filters.append(PricingModel.instance_id.in_(instance_ids))
    if not filters:
        filters.append(PricingModel.id.is_not(None))

    stmt = (
        select(PricingModel, Instance.name, Instance.program_type)
        .join(Instance, Instance.id == PricingModel.instance_id)
        .where(*filters)
        .order_by(PricingModel.model_name.asc(), PricingModel.instance_id.asc())
    )
    rows = db.execute(stmt).all()

    # Cheapest reachable group ratio per (instance, model) from enable_groups.
    ratio_by_instance = _group_ratio_maps(db)
    groups_by_instance_models: dict[tuple[int, str], list[str]] = {}
    for model, _name, _program in rows:
        groups_by_instance_models[(model.instance_id, model.model_name)] = list(
            model.enable_groups_json or []
        )

    def min_group_ratio(instance_id: int, model_name: str) -> float | None:
        ratios = ratio_by_instance.get(instance_id) or {}
        candidates = [
            ratios[group]
            for group in groups_by_instance_models.get((instance_id, model_name), [])
            if group in ratios
        ]
        return min(candidates) if candidates else None

    models_by_name: dict[str, dict[str, object]] = {}
    instances_meta: dict[int, dict[str, object]] = {}
    for model, instance_name, program_type in rows:
        instances_meta.setdefault(
            model.instance_id,
            {
                "instance_id": model.instance_id,
                "instance_name": instance_name,
                "program": program_type,
            },
        )
        bucket = models_by_name.setdefault(
            model.model_name,
            {"vendor_name": model.vendor_name, "entries": []},
        )
        if not bucket.get("vendor_name") and model.vendor_name:
            bucket["vendor_name"] = model.vendor_name

        tier_count = len(model.tiers_json or [])
        ratio = min_group_ratio(model.instance_id, model.model_name)
        effective_input = (
            model.price_input * ratio
            if model.price_input is not None and ratio is not None
            else model.price_input
        )
        bucket["entries"].append(
            PricingCompareEntry(
                instance_id=model.instance_id,
                pricing_model_id=model.id,
                quota_type=model.quota_type,
                billing_mode=model.billing_mode,
                tier_count=tier_count,
                has_time_pricing=bool(model.time_pricing_json),
                model_ratio=model.model_ratio,
                completion_ratio=model.completion_ratio,
                price_input=model.price_input,
                price_output=model.price_output,
                price_cache_read=model.price_cache_read,
                price_per_request=model.price_per_request,
                min_group_ratio=ratio,
                effective_input=effective_input,
            )
        )

    total = len(models_by_name)
    ordered_names = sorted(models_by_name)
    page_names = ordered_names[offset : offset + limit]

    model_rows: list[PricingCompareModelRow] = []
    for name in page_names:
        bucket = models_by_name[name]
        entries: list[PricingCompareEntry] = sorted(
            bucket["entries"], key=lambda entry: entry.instance_id  # type: ignore[arg-type, return-value]
        )
        comparable = [
            (entry.effective_input if entry.effective_input is not None else entry.price_input)
            for entry in entries
        ]
        comparable = [value for value in comparable if value is not None]
        best_instance_id = None
        if comparable:
            best_value = min(comparable)
            for entry in entries:
                candidate = entry.effective_input if entry.effective_input is not None else entry.price_input
                if candidate is not None and abs(candidate - best_value) < 1e-12:
                    best_instance_id = entry.instance_id
                    break
        model_rows.append(
            PricingCompareModelRow(
                model_name=name,
                vendor_name=bucket.get("vendor_name"),
                entries=entries,
                best_instance_id=best_instance_id,
                best_input_price=min(comparable) if comparable else None,
                worst_input_price=max(comparable) if comparable else None,
            )
        )

    return PricingCompareResponse(
        instances=sorted(instances_meta.values(), key=lambda item: item["instance_id"]),  # type: ignore[type-var,return-value]
        models=model_rows,
        total=total,
        offset=offset,
        limit=limit,
    )


def _pricing_filters(
    *,
    instance_id: int | None = None,
    search: str | None = None,
    group_name: str | None = None,
    tag: str | None = None,
    vendor: str | None = None,
    billing_kind: str | None = None,
    endpoint_type: str | None = None,
) -> list:
    """Build the shared WHERE clauses for pricing queries."""
    filters = []
    if instance_id is not None:
        filters.append(PricingModel.instance_id == instance_id)
    if search:
        pattern = f"%{search.strip()}%"
        filters.append(
            or_(PricingModel.model_name.ilike(pattern), PricingModel.vendor_name.ilike(pattern))
        )
    if group_name:
        # Stored as JSON array; LIKE against serialized values is good enough.
        pattern = f'%"{group_name}"%'
        filters.append(cast(PricingModel.enable_groups_json, String).like(pattern))
    if tag:
        pattern = f'%"{tag.strip()}"%'
        filters.append(cast(Instance.tags_json, String).like(pattern))
    if vendor:
        filters.append(PricingModel.vendor_name.ilike(f"%{vendor.strip()}%"))
    if endpoint_type:
        pattern = f'%"{endpoint_type.strip()}"%'
        filters.append(cast(PricingModel.supported_endpoint_types_json, String).like(pattern))
    if billing_kind:
        kind = billing_kind.strip().lower()
        if kind == "tiered":
            filters.append(
                or_(
                    PricingModel.billing_mode.in_(_TIERED_BILLING_MODES),
                    PricingModel.tiers_json.is_not(None),
                )
            )
        elif kind == "fixed":
            filters.append(
                and_(
                    or_(
                        PricingModel.billing_mode.notin_(_TIERED_BILLING_MODES),
                        PricingModel.billing_mode.is_(None),
                    ),
                    or_(PricingModel.quota_type != 0, PricingModel.price_per_request.is_not(None)),
                )
            )
        elif kind == "token":
            filters.append(
                and_(
                    PricingModel.quota_type == 0,
                    PricingModel.price_per_request.is_(None),
                    or_(
                        PricingModel.billing_mode.notin_(_TIERED_BILLING_MODES),
                        PricingModel.billing_mode.is_(None),
                    ),
                )
            )
        elif kind == "time":
            filters.append(PricingModel.time_pricing_json.is_not(None))
    return filters


def _group_ratio_maps(db: Session) -> dict[int, dict[str, float]]:
    """Map instance_id → {group_name: ratio} from the latest group snapshots."""
    result: dict[int, dict[str, float]] = {}
    rows = db.execute(select(GroupRatio.instance_id, GroupRatio.group_name, GroupRatio.ratio)).all()
    for instance_id, group_name, ratio in rows:
        result.setdefault(instance_id, {})[group_name] = float(ratio)
    return result
