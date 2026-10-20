"""Group ratio query service with user-defined labels and cross-instance compare."""

from __future__ import annotations

from sqlalchemy import String, cast, func, select
from sqlalchemy.orm import Session

from app.models import GroupLabel, GroupLabelAssignment, GroupRatio, Instance
from app.schemas.group import (
    GroupCompareEntry,
    GroupCompareResponse,
    GroupCompareRow,
    GroupLabelItem,
    GroupLabelListResponse,
    GroupNameFacetResponse,
    GroupRatioItem,
    GroupRatioListResponse,
)


def list_group_ratios(
    db: Session,
    instance_id: int | None = None,
    tag: str | None = None,
    label_id: int | None = None,
    search: str | None = None,
    platform: str | None = None,
) -> GroupRatioListResponse:
    """Return stored group ratios with instance metadata."""
    stmt = (
        select(GroupRatio, Instance.name, Instance.program_type)
        .join(Instance, Instance.id == GroupRatio.instance_id)
        .order_by(GroupRatio.instance_id.asc(), GroupRatio.group_name.asc())
    )

    if instance_id is not None:
        stmt = stmt.where(GroupRatio.instance_id == instance_id)
    if tag:
        pattern = f'%"{tag.strip()}"%'
        stmt = stmt.where(cast(Instance.tags_json, String).like(pattern))
    if search:
        stmt = stmt.where(GroupRatio.group_name.ilike(f"%{search.strip()}%"))
    if platform:
        stmt = stmt.where(GroupRatio.platform == platform.strip())
    if label_id is not None:
        stmt = stmt.where(
            GroupRatio.group_name.in_(
                select(GroupLabelAssignment.group_name).where(
                    GroupLabelAssignment.label_id == label_id
                )
            )
        )

    rows = db.execute(stmt).all()
    labels_by_group = _labels_by_group(db)

    items = [
        GroupRatioItem(
            id=group_ratio.id,
            instance_id=group_ratio.instance_id,
            instance_name=instance_name,
            instance_program=program_type,
            group_name=group_ratio.group_name,
            group_desc=group_ratio.group_desc,
            ratio=group_ratio.ratio,
            platform=group_ratio.platform,
            user_ratio=group_ratio.user_ratio,
            peak_ratio=group_ratio.peak_ratio,
            peak_start=group_ratio.peak_start,
            peak_end=group_ratio.peak_end,
            extra=group_ratio.extra_json or None,
            labels=labels_by_group.get(group_ratio.group_name, []),
            snapshot_at=group_ratio.snapshot_at,
        )
        for group_ratio, instance_name, program_type in rows
    ]
    return GroupRatioListResponse(total=len(items), items=items)


def compare_group_ratios(
    db: Session,
    *,
    label_id: int | None = None,
    label_name: str | None = None,
    instance_ids: list[int] | None = None,
    tag: str | None = None,
) -> GroupCompareResponse:
    """Compare ratios for the same group name across instances."""
    label = None
    group_names: list[str] = []
    if label_id is not None or label_name:
        label = _find_label(db, label_id=label_id, label_name=label_name)
        if label is None:
            return GroupCompareResponse(label=None, group_names=[], instances=[], rows=[])
        group_names = [item.group_name for item in label.assignments]
        if not group_names:
            return GroupCompareResponse(
                label=_label_item(label), group_names=[], instances=[], rows=[]
            )

    stmt = (
        select(GroupRatio, Instance.name, Instance.program_type)
        .join(Instance, Instance.id == GroupRatio.instance_id)
        .order_by(GroupRatio.group_name.asc(), GroupRatio.instance_id.asc())
    )
    if group_names:
        stmt = stmt.where(GroupRatio.group_name.in_(group_names))
    if instance_ids:
        stmt = stmt.where(GroupRatio.instance_id.in_(instance_ids))
    if tag:
        pattern = f'%"{tag.strip()}"%'
        stmt = stmt.where(cast(Instance.tags_json, String).like(pattern))

    rows = db.execute(stmt).all()
    grouped: dict[str, list[GroupCompareEntry]] = {}
    instances_meta: dict[int, dict[str, object]] = {}
    for group_ratio, instance_name, program_type in rows:
        instances_meta.setdefault(
            group_ratio.instance_id,
            {
                "instance_id": group_ratio.instance_id,
                "instance_name": instance_name,
                "program": program_type,
            },
        )
        grouped.setdefault(group_ratio.group_name, []).append(
            GroupCompareEntry(
                instance_id=group_ratio.instance_id,
                instance_name=instance_name,
                instance_program=program_type,
                ratio=group_ratio.ratio,
                user_ratio=group_ratio.user_ratio,
                platform=group_ratio.platform,
                peak_ratio=group_ratio.peak_ratio,
                peak_start=group_ratio.peak_start,
                peak_end=group_ratio.peak_end,
                group_desc=group_ratio.group_desc,
            )
        )

    compare_rows: list[GroupCompareRow] = []
    for group_name in sorted(grouped):
        entries = grouped[group_name]
        ratios = [entry.ratio for entry in entries]
        min_ratio = min(ratios) if ratios else None
        best_instance_id = None
        if min_ratio is not None:
            for entry in entries:
                if abs(entry.ratio - min_ratio) < 1e-12:
                    best_instance_id = entry.instance_id
                    break
        compare_rows.append(
            GroupCompareRow(
                group_name=group_name,
                entries=entries,
                min_ratio=min_ratio,
                max_ratio=max(ratios) if ratios else None,
                best_instance_id=best_instance_id,
                spread=(max(ratios) - min(ratios)) if len(ratios) > 1 else None,
            )
        )

    return GroupCompareResponse(
        label=_label_item(label) if label else None,
        group_names=group_names,
        instances=sorted(instances_meta.values(), key=lambda item: item["instance_id"]),  # type: ignore[type-var,return-value]
        rows=compare_rows,
    )


def list_group_labels(db: Session) -> GroupLabelListResponse:
    """Return all labels with their assigned group names."""
    labels = db.scalars(select(GroupLabel).order_by(GroupLabel.name.asc())).all()
    items = [_label_item(label) for label in labels]
    return GroupLabelListResponse(total=len(items), items=items)


def create_group_label(db: Session, name: str, color: str | None, remark: str | None, group_names: list[str]) -> GroupLabelItem:
    """Create one label and optionally assign group names to it."""
    label = GroupLabel(name=name.strip(), color=color, remark=remark)
    db.add(label)
    db.flush()
    for group_name in dict.fromkeys(group_names):
        db.add(GroupLabelAssignment(label_id=label.id, group_name=group_name.strip()))
    db.commit()
    db.refresh(label)
    return _label_item(label)


def update_group_label(
    db: Session,
    label_id: int,
    *,
    name: str | None = None,
    color: str | None = None,
    remark: str | None = None,
    group_names: list[str] | None = None,
) -> GroupLabelItem | None:
    """Update a label; when `group_names` is given the assignment set is replaced."""
    label = db.get(GroupLabel, label_id)
    if label is None:
        return None
    if name is not None:
        label.name = name.strip()
    if color is not None:
        label.color = color or None
    if remark is not None:
        label.remark = remark or None
    if group_names is not None:
        db.query(GroupLabelAssignment).filter(GroupLabelAssignment.label_id == label_id).delete()
        for group_name in dict.fromkeys(group_names):
            db.add(GroupLabelAssignment(label_id=label_id, group_name=group_name.strip()))
    db.commit()
    db.refresh(label)
    return _label_item(label)


def delete_group_label(db: Session, label_id: int) -> bool:
    """Delete one label; assignments cascade."""
    label = db.get(GroupLabel, label_id)
    if label is None:
        return False
    db.delete(label)
    db.commit()
    return True


def distinct_group_names(db: Session) -> GroupNameFacetResponse:
    """Return every distinct group name known from synced ratios."""
    names = sorted(
        {
            value
            for (value,) in db.execute(select(GroupRatio.group_name).distinct()).all()
            if value
        }
    )
    return GroupNameFacetResponse(total=len(names), items=names)


def _find_label(db: Session, *, label_id: int | None, label_name: str | None) -> GroupLabel | None:
    stmt = select(GroupLabel)
    if label_id is not None:
        stmt = stmt.where(GroupLabel.id == label_id)
    elif label_name:
        stmt = stmt.where(GroupLabel.name == label_name.strip())
    return db.scalars(stmt.order_by(GroupLabel.id.asc()).limit(1)).first()


def _label_item(label: GroupLabel) -> GroupLabelItem:
    return GroupLabelItem(
        id=label.id,
        name=label.name,
        color=label.color,
        remark=label.remark,
        group_names=sorted(item.group_name for item in label.assignments),
        created_at=label.created_at,
    )


def _labels_by_group(db: Session) -> dict[str, list[str]]:
    """Map group_name → sorted label names for decorating ratio rows."""
    rows = db.execute(
        select(GroupLabelAssignment.group_name, GroupLabel.name).join(
            GroupLabel, GroupLabel.id == GroupLabelAssignment.label_id
        )
    ).all()
    mapping: dict[str, list[str]] = {}
    for group_name, label_name in rows:
        mapping.setdefault(group_name, []).append(label_name)
    return {group_name: sorted(names) for group_name, names in mapping.items()}
