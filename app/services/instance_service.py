"""Instance CRUD helpers."""

from fastapi import HTTPException, status
from sqlalchemy import String, cast, select
from sqlalchemy.orm import Session, selectinload

from app.models import Instance
from app.schemas.instance import (
    BatchInstanceDeleteResponse,
    BatchInstanceResponse,
    BatchInstanceUpdateItem,
    InstanceCreate,
    InstanceListResponse,
    InstanceResponse,
    InstanceUpdate,
)


def _normalize_tags(tags: list[str] | None) -> list[str]:
    """Return normalized instance tags without blanks or duplicates."""
    normalized: list[str] = []
    seen: set[str] = set()

    for item in tags or []:
        value = item.strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)

    return normalized


def _apply_tag_filter(stmt, tag: str | None):
    """Filter rows by one exact tag stored in a JSON array."""
    if not tag:
        return stmt

    pattern = f'%"{tag.strip()}"%'
    return stmt.where(cast(Instance.tags_json, String).like(pattern))


def create_instance(db: Session, payload: InstanceCreate) -> Instance:
    """Create and persist a new instance record."""
    instance = Instance(
        name=payload.name.strip(),
        base_url=payload.base_url.rstrip("/"),
        username=payload.username.strip(),
        password=payload.password,
        enabled=payload.enabled,
        tags_json=_normalize_tags(payload.tags),
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)
    return instance


def create_instances_batch(db: Session, payloads: list[InstanceCreate]) -> BatchInstanceResponse:
    """Create multiple instances in one transaction."""
    instances = [
        Instance(
            name=payload.name.strip(),
            base_url=payload.base_url.rstrip("/"),
            username=payload.username.strip(),
            password=payload.password,
            enabled=payload.enabled,
            tags_json=_normalize_tags(payload.tags),
        )
        for payload in payloads
    ]

    db.add_all(instances)
    db.commit()

    for instance in instances:
        db.refresh(instance)

    items = [_instance_to_response(instance) for instance in instances]
    return BatchInstanceResponse(count=len(items), items=items)


def update_instance(db: Session, instance: Instance, payload: InstanceUpdate) -> Instance:
    """Update a configured instance and persist the changes."""
    instance.name = payload.name.strip()
    instance.base_url = payload.base_url.rstrip("/")
    instance.username = payload.username.strip()
    instance.enabled = payload.enabled
    instance.tags_json = _normalize_tags(payload.tags)

    if payload.password:
        instance.password = payload.password

    db.commit()
    db.refresh(instance)
    return instance


def update_instances_batch(db: Session, payloads: list[BatchInstanceUpdateItem]) -> BatchInstanceResponse:
    """Update multiple instances in one transaction."""
    ids = [item.id for item in payloads]
    if not ids:
        return BatchInstanceResponse(count=0, items=[])

    instances = db.scalars(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id.in_(ids))
        .order_by(Instance.id.asc())
    ).all()
    instances_by_id = {instance.id: instance for instance in instances}

    missing_ids = [instance_id for instance_id in ids if instance_id not in instances_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instances not found: {', '.join(str(item) for item in missing_ids)}.",
        )

    for payload in payloads:
        instance = instances_by_id[payload.id]
        instance.name = payload.name.strip()
        instance.base_url = payload.base_url.rstrip("/")
        instance.username = payload.username.strip()
        instance.enabled = payload.enabled
        instance.tags_json = _normalize_tags(payload.tags)
        if payload.password:
            instance.password = payload.password

    db.commit()

    refreshed_instances = db.scalars(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id.in_(ids))
        .order_by(Instance.id.asc())
    ).all()
    items = [_instance_to_response(instance) for instance in refreshed_instances]
    return BatchInstanceResponse(count=len(items), items=items)


def delete_instance(db: Session, instance: Instance) -> None:
    """Delete one instance and all related rows through cascading FKs."""
    db.delete(instance)
    db.commit()


def delete_instances_batch(db: Session, ids: list[int]) -> BatchInstanceDeleteResponse:
    """Delete multiple instances in one transaction."""
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        return BatchInstanceDeleteResponse(count=0, deleted_ids=[])

    instances = db.scalars(select(Instance).where(Instance.id.in_(unique_ids))).all()
    found_ids = {instance.id for instance in instances}
    missing_ids = [instance_id for instance_id in unique_ids if instance_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instances not found: {', '.join(str(item) for item in missing_ids)}.",
        )

    for instance in instances:
        db.delete(instance)

    db.commit()
    return BatchInstanceDeleteResponse(count=len(unique_ids), deleted_ids=unique_ids)


def get_instance_or_404(db: Session, instance_id: int) -> Instance:
    """Fetch one instance or raise an HTTP 404 for API callers."""
    instance = db.scalar(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id == instance_id)
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found.")
    return instance


def list_instances(db: Session, tag: str | None = None) -> InstanceListResponse:
    """Return all configured instances with session metadata when available."""
    stmt = (
        select(Instance)
        .options(selectinload(Instance.session))
        .order_by(Instance.id.asc())
    )
    instances = db.scalars(_apply_tag_filter(stmt, tag)).all()

    items = [_instance_to_response(instance) for instance in instances]

    return InstanceListResponse(total=len(items), items=items)


def _instance_to_response(instance: Instance) -> InstanceResponse:
    """Convert one ORM instance into the API response shape."""
    return InstanceResponse.model_validate(instance).model_copy(
        update={
            "tags": instance.tags_json or [],
            "quota_per_unit": instance.quota_per_unit,
            "remote_user_id": instance.session.remote_user_id if instance.session else None,
            "session_expires_at": instance.session.expires_at if instance.session else None,
        }
    )
