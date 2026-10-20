"""Group ratio and group label response schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class GroupRatioItem(BaseModel):
    """Flattened group ratio row for API responses."""

    id: int
    instance_id: int
    instance_name: str
    instance_program: str = "newapi"
    group_name: str
    group_desc: str | None = None
    ratio: float
    platform: str | None = None
    user_ratio: float | None = None
    peak_ratio: float | None = None
    peak_start: str | None = None
    peak_end: str | None = None
    extra: dict[str, Any] | None = None
    labels: list[str] = []
    snapshot_at: datetime


class GroupRatioListResponse(BaseModel):
    """List wrapper for group ratio queries."""

    total: int
    items: list[GroupRatioItem]


class GroupLabelItem(BaseModel):
    """One user-defined group label with its assigned group names."""

    id: int
    name: str
    color: str | None = None
    remark: str | None = None
    group_names: list[str] = []
    created_at: datetime


class GroupLabelListResponse(BaseModel):
    total: int
    items: list[GroupLabelItem]


class GroupLabelCreatePayload(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    color: str | None = Field(default=None, max_length=32)
    remark: str | None = Field(default=None, max_length=255)
    group_names: list[str] = Field(default_factory=list)


class GroupLabelUpdatePayload(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=100)
    color: str | None = Field(default=None, max_length=32)
    remark: str | None = Field(default=None, max_length=255)
    # When provided, replaces the whole assignment set for the label.
    group_names: list[str] | None = None


class GroupCompareEntry(BaseModel):
    """One instance's ratio data for one group name inside a comparison row."""

    instance_id: int
    instance_name: str
    instance_program: str = "newapi"
    ratio: float
    user_ratio: float | None = None
    platform: str | None = None
    peak_ratio: float | None = None
    peak_start: str | None = None
    peak_end: str | None = None
    group_desc: str | None = None


class GroupCompareRow(BaseModel):
    """Cross-instance ratio comparison for one group name."""

    group_name: str
    entries: list[GroupCompareEntry]
    min_ratio: float | None = None
    max_ratio: float | None = None
    best_instance_id: int | None = None
    spread: float | None = None


class GroupCompareResponse(BaseModel):
    """Response for the group ratio comparison endpoint."""

    label: GroupLabelItem | None = None
    group_names: list[str] = []
    instances: list[dict[str, Any]]
    rows: list[GroupCompareRow]


class GroupNameFacetResponse(BaseModel):
    """Distinct group names for the label assignment UI."""

    total: int
    items: list[str]
