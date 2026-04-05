"""Runtime settings routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.database import is_sqlite_locked_error
from app.schemas.app_setting import (
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    NotificationTestRequest,
    NotificationTestResponse,
)
from app.services.app_setting_service import build_app_settings_response, update_app_settings
from app.services.notification_service import send_test_notification


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


@router.get("/settings", response_model=AppSettingsResponse)
def get_settings_route(db: Session = Depends(get_db)) -> AppSettingsResponse:
    """Return effective runtime settings."""
    return build_app_settings_response(db)


@router.patch("/settings", response_model=AppSettingsResponse)
def update_settings_route(
    payload: AppSettingsUpdateRequest,
    db: Session = Depends(get_db),
) -> AppSettingsResponse:
    """Persist runtime settings overrides."""
    try:
        return update_app_settings(db, payload)
    except (ValidationError, ValueError) as exc:
        db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except OperationalError as exc:
        _raise_if_sqlite_locked(exc, db)


@router.post("/settings/notifications/test", response_model=NotificationTestResponse)
def send_test_notification_route(
    payload: NotificationTestRequest,
    db: Session = Depends(get_db),
) -> NotificationTestResponse:
    """Send a sample notification through configured Apprise channels."""
    try:
        return send_test_notification(db, payload)
    except (ValidationError, ValueError) as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
