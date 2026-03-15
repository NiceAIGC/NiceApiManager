"""Group ratio query service."""

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.models import GroupRatio, Instance
from app.schemas.group import GroupRatioItem, GroupRatioListResponse


def list_group_ratios(
    db: Session,
    instance_id: int | None = None,
    tag: str | None = None,
) -> GroupRatioListResponse:
    """Return stored group ratios with instance metadata."""
    stmt = (
        select(GroupRatio, Instance.name)
        .join(Instance, Instance.id == GroupRatio.instance_id)
        .order_by(GroupRatio.instance_id.asc(), GroupRatio.group_name.asc())
    )
    count_stmt = (
        select(func.count(GroupRatio.id))
        .select_from(GroupRatio)
        .join(Instance, Instance.id == GroupRatio.instance_id)
    )

    if instance_id is not None:
        stmt = stmt.where(GroupRatio.instance_id == instance_id)
        count_stmt = count_stmt.where(GroupRatio.instance_id == instance_id)

    if tag:
        pattern = f'%"{tag.strip()}"%'
        stmt = stmt.where(cast(Instance.tags_json, String).like(pattern))
        count_stmt = count_stmt.where(cast(Instance.tags_json, String).like(pattern))

    rows = db.execute(stmt).all()
    total = db.scalar(count_stmt) or 0

    return GroupRatioListResponse(
        total=total,
        items=[
            GroupRatioItem(
                id=group_ratio.id,
                instance_id=group_ratio.instance_id,
                instance_name=instance_name,
                group_name=group_ratio.group_name,
                group_desc=group_ratio.group_desc,
                ratio=group_ratio.ratio,
                snapshot_at=group_ratio.snapshot_at,
            )
            for group_ratio, instance_name in rows
        ],
    )
