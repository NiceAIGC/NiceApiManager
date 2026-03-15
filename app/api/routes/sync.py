"""Manual sync routes."""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.sync_run import BulkSyncResponse, SyncRunResponse
from app.services.instance_service import get_instance_or_404
from app.services.sync_service import sync_all_instances, sync_single_instance


router = APIRouter()


@router.post("/instances/{instance_id}/sync", response_model=SyncRunResponse)
def sync_instance_route(
    instance_id: int,
    db: Session = Depends(get_db),
) -> SyncRunResponse:
    """Run a manual sync for one configured instance."""
    instance = get_instance_or_404(db, instance_id)
    sync_run = sync_single_instance(db, instance=instance, trigger_type="manual")
    return SyncRunResponse.model_validate(sync_run)


@router.post("/sync/all", response_model=BulkSyncResponse)
def sync_all_instances_route(db: Session = Depends(get_db)) -> BulkSyncResponse:
    """Run manual sync against all enabled instances."""
    return sync_all_instances(db)

