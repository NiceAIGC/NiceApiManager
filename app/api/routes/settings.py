"""Runtime settings routes."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.database import is_sqlite_locked_error
from app.schemas.app_setting import AppSettingsResponse, AppSettingsUpdateRequest
from app.services.app_setting_service import build_app_settings_response, update_app_settings


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
    except OperationalError as exc:
        _raise_if_sqlite_locked(exc, db)
