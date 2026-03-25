"""Sync history schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class SyncRunResponse(BaseModel):
    """Public view of a sync run."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    instance_id: int
    trigger_type: str
    status: str
    started_at: datetime
    finished_at: datetime | None = None
    duration_ms: int | None = None
    error_message: str | None = None
    summary_json: dict[str, Any] | None = None


class SyncRunListItem(SyncRunResponse):
    """Sync run row enriched with instance name."""

    instance_name: str


class SyncRunListResponse(BaseModel):
    """List wrapper for sync history."""

    total: int
    offset: int
    limit: int
    items: list[SyncRunListItem]


class BulkSyncInstanceResult(BaseModel):
    """Per-instance result returned from bulk manual sync."""

    instance_id: int
    instance_name: str
    status: str
    sync_run_id: int | None = None
    error_message: str | None = None


class BulkSyncRequest(BaseModel):
    """Optional input used to scope a bulk sync to selected instances."""

    instance_ids: list[int] | None = None


class BulkSyncResponse(BaseModel):
    """Summary returned after manual sync-all."""

    total: int
    max_workers: int
    success_count: int
    failed_count: int
    items: list[BulkSyncInstanceResult]
