"""Dashboard routes."""

from datetime import date, timedelta

from fastapi import APIRouter, Depends, Query
from fastapi.exceptions import HTTPException
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
    days: int | None = Query(default=7, ge=1, le=90, description="Trend window in days."),
    start_date: date | None = Query(default=None, description="Custom trend start date."),
    end_date: date | None = Query(default=None, description="Custom trend end date."),
    breakdown_limit: int = Query(default=8, ge=1, le=20, description="How many instances to show in the stacked breakdown."),
    search: str | None = Query(default=None, description="Keyword matched against name, URL, or username."),
    tag: str | None = Query(default=None, description="Backward-compatible single tag filter."),
    tags: str | None = Query(default=None, description="Comma-separated tag filter."),
    billing_mode: str | None = Query(default=None, description="Billing mode filter."),
    enabled: bool | None = Query(default=None, description="Enabled status filter."),
    health_status: str | None = Query(default=None, description="Health status filter."),
    db: Session = Depends(get_db),
) -> DashboardTrendResponse:
    """Return recent daily usage trends for the filtered instance set."""
    if (start_date is None) != (end_date is None):
        raise HTTPException(status_code=422, detail="start_date and end_date must be provided together.")

    if start_date and end_date:
        if start_date > end_date:
            raise HTTPException(status_code=422, detail="start_date must be on or before end_date.")
        if (end_date - start_date) >= timedelta(days=90):
            raise HTTPException(status_code=422, detail="custom date range cannot exceed 90 days.")

    return build_dashboard_trends(
        db,
        days=days,
        start_date=start_date,
        end_date=end_date,
        breakdown_limit=breakdown_limit,
        search=search,
        tags=tags or tag,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )
