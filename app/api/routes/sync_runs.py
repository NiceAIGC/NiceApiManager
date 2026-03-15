"""Sync run history routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.sync_run import SyncRunListResponse
from app.services.sync_run_service import list_sync_runs


router = APIRouter()


@router.get("/sync-runs", response_model=SyncRunListResponse)
def get_sync_runs(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> SyncRunListResponse:
    """Return sync history ordered by most recent run first."""
    return list_sync_runs(db, instance_id=instance_id, offset=offset, limit=limit)

