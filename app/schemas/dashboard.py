"""Dashboard response schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict


class DashboardInstanceSummary(BaseModel):
    """Latest per-instance counters used on the overview page."""

    model_config = ConfigDict(from_attributes=True)

    instance_id: int
    instance_name: str
    enabled: bool
    billing_mode: Literal["prepaid", "postpaid"]
    tags: list[str]
    quota_per_unit: float | None = None
    health_status: str
    health_error: str | None = None
    last_sync_at: datetime | None = None
    latest_group_name: str | None = None
    latest_quota: int | None = None
    latest_used_quota: int | None = None
    latest_display_quota: float | None = None
    latest_display_used_quota: float | None = None
    latest_request_count: int | None = None
    today_request_count: int = 0


class DashboardOverviewResponse(BaseModel):
    """Aggregated totals plus per-instance details."""

    instance_count: int
    enabled_instance_count: int
    healthy_instance_count: int
    unhealthy_instance_count: int
    total_quota: int
    total_used_quota: int
    total_display_quota: float
    total_display_used_quota: float
    total_request_count: int
    today_request_count: int
    items: list[DashboardInstanceSummary]
