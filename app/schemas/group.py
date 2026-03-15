"""Group ratio response schemas."""

from datetime import datetime

from pydantic import BaseModel


class GroupRatioItem(BaseModel):
    """Flattened group ratio row for API responses."""

    id: int
    instance_id: int
    instance_name: str
    group_name: str
    group_desc: str | None = None
    ratio: float
    snapshot_at: datetime


class GroupRatioListResponse(BaseModel):
    """List wrapper for group ratio queries."""

    total: int
    items: list[GroupRatioItem]

