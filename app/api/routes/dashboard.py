"""Dashboard routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.dashboard import DashboardOverviewResponse
from app.services.dashboard_service import build_dashboard_overview


router = APIRouter()


@router.get("/dashboard/overview", response_model=DashboardOverviewResponse)
def get_dashboard_overview(
    tag: str | None = Query(default=None, description="Filter by one instance tag."),
    db: Session = Depends(get_db),
) -> DashboardOverviewResponse:
    """Return the latest aggregated view across all configured instances."""
    return build_dashboard_overview(db, tag=tag)
