"""Group aggregation routes with labels and cross-instance comparison."""

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.group import (
    GroupCompareResponse,
    GroupLabelCreatePayload,
    GroupLabelItem,
    GroupLabelListResponse,
    GroupLabelUpdatePayload,
    GroupNameFacetResponse,
    GroupRatioListResponse,
)
from app.services.group_service import (
    compare_group_ratios,
    create_group_label,
    delete_group_label,
    distinct_group_names,
    list_group_labels,
    list_group_ratios,
    update_group_label,
)


router = APIRouter()


@router.get("/groups", response_model=GroupRatioListResponse)
def get_group_ratios(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    label_id: int | None = Query(default=None, description="Filter by group label ID."),
    search: str | None = Query(default=None, description="Filter by group name substring."),
    platform: str | None = Query(default=None, description="Filter by Sub2API platform."),
    db: Session = Depends(get_db),
) -> GroupRatioListResponse:
    """Return the current group ratios stored in SQLite."""
    return list_group_ratios(
        db,
        instance_id=instance_id,
        tag=tag,
        label_id=label_id,
        search=search,
        platform=platform,
    )


@router.get("/groups/compare", response_model=GroupCompareResponse)
def get_group_comparison(
    label_id: int | None = Query(default=None, description="Compare groups under this label."),
    label_name: str | None = Query(default=None, description="Compare groups under this label name."),
    instance_ids: str | None = Query(default=None, description="Comma-separated instance IDs."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    db: Session = Depends(get_db),
) -> GroupCompareResponse:
    """Compare group ratios for the same group name across instances."""
    if label_id is None and not label_name:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="label_id or label_name is required.",
        )
    parsed_ids: list[int] | None = None
    if instance_ids:
        try:
            parsed_ids = [int(part) for part in instance_ids.split(",") if part.strip()]
        except ValueError:
            parsed_ids = []
        parsed_ids = parsed_ids or None
    return compare_group_ratios(
        db,
        label_id=label_id,
        label_name=label_name,
        instance_ids=parsed_ids,
        tag=tag,
    )


@router.get("/groups/names", response_model=GroupNameFacetResponse)
def get_group_names(db: Session = Depends(get_db)) -> GroupNameFacetResponse:
    """Return every distinct group name known from synced ratios."""
    return distinct_group_names(db)


@router.get("/groups/labels", response_model=GroupLabelListResponse)
def get_group_labels(db: Session = Depends(get_db)) -> GroupLabelListResponse:
    """Return all group labels with their assigned group names."""
    return list_group_labels(db)


@router.post(
    "/groups/labels",
    response_model=GroupLabelItem,
    status_code=status.HTTP_201_CREATED,
)
def post_group_label(
    payload: GroupLabelCreatePayload,
    db: Session = Depends(get_db),
) -> GroupLabelItem:
    """Create a group label and optionally assign group names to it."""
    return create_group_label(db, payload.name, payload.color, payload.remark, payload.group_names)


@router.patch("/groups/labels/{label_id}", response_model=GroupLabelItem)
def patch_group_label(
    label_id: int,
    payload: GroupLabelUpdatePayload,
    db: Session = Depends(get_db),
) -> GroupLabelItem:
    """Update one group label; `group_names` replaces the assignment set."""
    item = update_group_label(
        db,
        label_id,
        name=payload.name,
        color=payload.color,
        remark=payload.remark,
        group_names=payload.group_names,
    )
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found.")
    return item


@router.delete("/groups/labels/{label_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_label_route(label_id: int, db: Session = Depends(get_db)) -> None:
    """Delete one group label together with its assignments."""
    if not delete_group_label(db, label_id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Label not found.")
