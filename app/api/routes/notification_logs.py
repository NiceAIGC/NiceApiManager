"""Notification history routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.notification_log import NotificationLogListResponse
from app.services.notification_log_service import list_notification_logs


router = APIRouter()


@router.get("/notification-logs", response_model=NotificationLogListResponse)
def get_notification_logs(
    instance_id: int | None = Query(default=None, description="Filter by local instance ID."),
    source_type: str | None = Query(default=None, description="Filter by source type: rule or test."),
    offset: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=200),
    db: Session = Depends(get_db),
) -> NotificationLogListResponse:
    """Return notification history ordered by newest first."""
    return list_notification_logs(
        db,
        instance_id=instance_id,
        source_type=source_type,
        offset=offset,
        limit=limit,
    )
