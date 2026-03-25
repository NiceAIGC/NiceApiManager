"""Manual sync routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.database import is_sqlite_locked_error
from app.schemas.sync_run import BulkSyncResponse, SyncRunResponse
from app.services.instance_service import get_instance_or_404
from app.services.sync_service import sync_all_instances, sync_single_instance


router = APIRouter()


def _raise_if_sqlite_locked(exc: OperationalError, db: Session) -> None:
    """Translate SQLite busy errors into a retryable API response."""
    db.rollback()
    if is_sqlite_locked_error(exc):
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="本地数据库正忙，请稍后重试。",
        ) from exc
    raise exc


@router.post("/instances/{instance_id}/sync", response_model=SyncRunResponse)
def sync_instance_route(
    instance_id: int,
    db: Session = Depends(get_db),
) -> SyncRunResponse:
    """Run a manual sync for one configured instance."""
    instance = get_instance_or_404(db, instance_id)
    try:
        sync_run = sync_single_instance(db, instance=instance, trigger_type="manual")
    except OperationalError as exc:
        _raise_if_sqlite_locked(exc, db)
    return SyncRunResponse.model_validate(sync_run)


@router.post("/sync/all", response_model=BulkSyncResponse)
def sync_all_instances_route(db: Session = Depends(get_db)) -> BulkSyncResponse:
    """Run manual sync against all enabled instances."""
    try:
        return sync_all_instances(db)
    except OperationalError as exc:
        _raise_if_sqlite_locked(exc, db)
