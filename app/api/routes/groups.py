"""Group aggregation routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.group import GroupRatioListResponse
from app.services.group_service import list_group_ratios


router = APIRouter()


@router.get("/groups", response_model=GroupRatioListResponse)
def get_group_ratios(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    db: Session = Depends(get_db),
) -> GroupRatioListResponse:
    """Return the current group ratios stored in SQLite."""
    return list_group_ratios(db, instance_id=instance_id, tag=tag)
