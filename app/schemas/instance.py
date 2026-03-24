"""Instance management schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class InstanceCreate(BaseModel):
    """Payload for creating a configured NewAPI instance."""

    name: str
    base_url: str
    username: str
    password: str
    enabled: bool = True
    billing_mode: Literal["prepaid", "postpaid"] = "prepaid"
    tags: list[str] = Field(default_factory=list)


class InstanceUpdate(BaseModel):
    """Payload for updating an existing configured NewAPI instance."""

    name: str
    base_url: str
    username: str
    password: str | None = None
    enabled: bool = True
    billing_mode: Literal["prepaid", "postpaid"] = "prepaid"
    tags: list[str] = Field(default_factory=list)


class InstanceResponse(BaseModel):
    """Instance list/detail shape used by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    base_url: str
    username: str
    enabled: bool
    billing_mode: Literal["prepaid", "postpaid"]
    tags: list[str] = Field(default_factory=list)
    quota_per_unit: float | None = None
    last_sync_at: datetime | None = None
    last_health_status: str
    last_health_error: str | None = None
    created_at: datetime
    updated_at: datetime
    remote_user_id: int | None = None
    session_expires_at: datetime | None = None


class InstanceListResponse(BaseModel):
    """Wrapper for instance listing."""

    total: int
    items: list[InstanceResponse]


class InstanceTestResponse(BaseModel):
    """Result of connectivity testing against one remote NewAPI instance."""

    success: bool
    instance_id: int
    remote_user_id: int
    remote_username: str
    remote_group: str | None = None
    billing_mode: Literal["prepaid", "postpaid"]
    quota: int
    used_quota: int
    display_quota: float | None = None
    display_used_quota: float | None = None
    quota_per_unit: float | None = None
    request_count: int
    group_count: int
    pricing_model_count: int


class BatchInstanceCreateRequest(BaseModel):
    """Payload for creating multiple instances in one request."""

    items: list[InstanceCreate] = Field(default_factory=list)


class BatchInstanceUpdateItem(InstanceUpdate):
    """One instance update entry used in batch edit operations."""

    id: int


class BatchInstanceUpdateRequest(BaseModel):
    """Payload for updating multiple instances in one request."""

    items: list[BatchInstanceUpdateItem] = Field(default_factory=list)


class BatchInstanceDeleteRequest(BaseModel):
    """Payload for deleting multiple instances in one request."""

    ids: list[int] = Field(default_factory=list)


class BatchInstanceResponse(BaseModel):
    """Common response for batch create and batch update operations."""

    count: int
    items: list[InstanceResponse]


class BatchInstanceDeleteResponse(BaseModel):
    """Response for batch delete operations."""

    count: int
    deleted_ids: list[int]
