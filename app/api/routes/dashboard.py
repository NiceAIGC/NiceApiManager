"""Dashboard routes."""

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.schemas.dashboard import DashboardOverviewResponse, DashboardTrendResponse
from app.services.dashboard_service import build_dashboard_overview, build_dashboard_trends


router = APIRouter()


@router.get("/dashboard/overview", response_model=DashboardOverviewResponse)
def get_dashboard_overview(
    search: str | None = Query(default=None, description="Keyword matched against name, URL, or username."),
    tag: str | None = Query(default=None, description="Backward-compatible single tag filter."),
    tags: str | None = Query(default=None, description="Comma-separated tag filter."),
    billing_mode: str | None = Query(default=None, description="Billing mode filter."),
    enabled: bool | None = Query(default=None, description="Enabled status filter."),
    health_status: str | None = Query(default=None, description="Health status filter."),
    db: Session = Depends(get_db),
) -> DashboardOverviewResponse:
    """Return the latest aggregated view across all configured instances."""
    return build_dashboard_overview(
        db,
        search=search,
        tags=tags or tag,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )


@router.get("/dashboard/trends", response_model=DashboardTrendResponse)
def get_dashboard_trends(
    days: int = Query(default=7, ge=7, le=30, description="Trend window in days."),
    search: str | None = Query(default=None, description="Keyword matched against name, URL, or username."),
    tag: str | None = Query(default=None, description="Backward-compatible single tag filter."),
    tags: str | None = Query(default=None, description="Comma-separated tag filter."),
    billing_mode: str | None = Query(default=None, description="Billing mode filter."),
    enabled: bool | None = Query(default=None, description="Enabled status filter."),
    health_status: str | None = Query(default=None, description="Health status filter."),
    db: Session = Depends(get_db),
) -> DashboardTrendResponse:
    """Return recent daily usage trends for the filtered instance set."""
    return build_dashboard_trends(
        db,
        days=days,
        search=search,
        tags=tags or tag,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )
