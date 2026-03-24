"""Instance management routes."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.instance import (
    BatchInstanceCreateRequest,
    BatchInstanceDeleteRequest,
    BatchInstanceDeleteResponse,
    BatchInstanceResponse,
    BatchInstanceUpdateRequest,
    InstanceCreate,
    InstanceListResponse,
    InstanceResponse,
    InstanceTestResponse,
    InstanceUpdate,
)
from app.services.instance_service import (
    create_instance,
    create_instances_batch,
    delete_instance,
    delete_instances_batch,
    get_instance_or_404,
    list_instances,
    update_instance,
    update_instances_batch,
)
from app.services.sync_service import test_instance_connectivity


router = APIRouter()


@router.post(
    "/instances",
    response_model=InstanceResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_instance_route(
    payload: InstanceCreate,
    db: Session = Depends(get_db),
) -> InstanceResponse:
    """Create a new NewAPI instance configuration."""
    try:
        instance = create_instance(db, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Instance name already exists.",
        ) from exc
    return InstanceResponse.model_validate(instance).model_copy(update={"tags": instance.tags_json or []})


@router.get("/instances", response_model=InstanceListResponse)
def list_instances_route(
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    db: Session = Depends(get_db),
) -> InstanceListResponse:
    """List configured instances with current sync and session metadata."""
    return list_instances(db, tag=tag)


@router.post("/instances/batch-create", response_model=BatchInstanceResponse, status_code=status.HTTP_201_CREATED)
def batch_create_instances_route(
    payload: BatchInstanceCreateRequest,
    db: Session = Depends(get_db),
) -> BatchInstanceResponse:
    """Create multiple NewAPI instance configurations."""
    try:
        return create_instances_batch(db, payload.items)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more instance names already exist.",
        ) from exc


@router.patch("/instances/batch-update", response_model=BatchInstanceResponse)
def batch_update_instances_route(
    payload: BatchInstanceUpdateRequest,
    db: Session = Depends(get_db),
) -> BatchInstanceResponse:
    """Update multiple configured instances."""
    try:
        return update_instances_batch(db, payload.items)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="One or more instance names already exist.",
        ) from exc


@router.post("/instances/batch-delete", response_model=BatchInstanceDeleteResponse)
def batch_delete_instances_route(
    payload: BatchInstanceDeleteRequest,
    db: Session = Depends(get_db),
) -> BatchInstanceDeleteResponse:
    """Delete multiple configured instances."""
    return delete_instances_batch(db, payload.ids)


@router.patch("/instances/{instance_id}", response_model=InstanceResponse)
def update_instance_route(
    instance_id: int,
    payload: InstanceUpdate,
    db: Session = Depends(get_db),
) -> InstanceResponse:
    """Update one configured NewAPI instance."""
    instance = get_instance_or_404(db, instance_id)
    try:
        instance = update_instance(db, instance, payload)
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Instance name already exists.",
        ) from exc

    return InstanceResponse.model_validate(instance).model_copy(
        update={
            "tags": instance.tags_json or [],
            "billing_mode": instance.billing_mode,
            "quota_per_unit": instance.quota_per_unit,
            "remote_user_id": instance.session.remote_user_id if instance.session else None,
            "session_expires_at": instance.session.expires_at if instance.session else None,
        }
    )


@router.delete("/instances/{instance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_instance_route(
    instance_id: int,
    db: Session = Depends(get_db),
) -> None:
    """Delete one configured instance."""
    instance = get_instance_or_404(db, instance_id)
    delete_instance(db, instance)


@router.post("/instances/{instance_id}/test", response_model=InstanceTestResponse)
def test_instance_route(
    instance_id: int,
    db: Session = Depends(get_db),
) -> InstanceTestResponse:
    """Test read-only connectivity against the configured NewAPI instance."""
    instance = get_instance_or_404(db, instance_id)
    return test_instance_connectivity(db, instance)
