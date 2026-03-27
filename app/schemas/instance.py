"""Instance management schemas."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator


ProgramType = Literal["newapi", "rixapi", "shellapi"]
ProxyMode = Literal["direct", "global", "custom"]


class InstanceCreate(BaseModel):
    """Payload for creating a configured NewAPI instance."""

    name: str
    base_url: str
    program_type: ProgramType = "newapi"
    username: str = ""
    password: str | None = None
    remote_user_id: int | None = None
    access_token: str | None = None
    proxy_mode: ProxyMode = "direct"
    socks5_proxy_url: str | None = None
    enabled: bool = True
    billing_mode: Literal["prepaid", "postpaid"] = "prepaid"
    priority: int = Field(default=3, ge=1, le=5)
    sync_interval_minutes: int | None = Field(default=None, ge=5, le=10080)
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_auth_fields(self) -> "InstanceCreate":
        username = self.username.strip()
        password = (self.password or "").strip()
        access_token = (self.access_token or "").strip()
        has_password_auth = bool(username and password)
        has_token_auth = self.remote_user_id is not None and bool(access_token)

        if not has_password_auth and not has_token_auth:
            raise ValueError("请填写用户名和密码，或填写远端用户 ID 和访问密钥。")

        if self.proxy_mode == "custom" and not (self.socks5_proxy_url or "").strip():
            raise ValueError("选择自定义 SOCKS5 代理时，请填写代理地址。")

        return self


class InstanceUpdate(BaseModel):
    """Payload for updating an existing configured NewAPI instance."""

    name: str
    base_url: str
    program_type: ProgramType = "newapi"
    username: str = ""
    password: str | None = None
    remote_user_id: int | None = None
    access_token: str | None = None
    proxy_mode: ProxyMode = "direct"
    socks5_proxy_url: str | None = None
    enabled: bool = True
    billing_mode: Literal["prepaid", "postpaid"] = "prepaid"
    priority: int = Field(default=3, ge=1, le=5)
    sync_interval_minutes: int = Field(ge=5, le=10080)
    tags: list[str] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_proxy_fields(self) -> "InstanceUpdate":
        if self.proxy_mode == "custom" and not (self.socks5_proxy_url or "").strip():
            raise ValueError("选择自定义 SOCKS5 代理时，请填写代理地址。")
        return self


class InstanceResponse(BaseModel):
    """Instance list/detail shape used by the API."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    name: str
    base_url: str
    program_type: ProgramType
    username: str
    proxy_mode: ProxyMode
    enabled: bool
    billing_mode: Literal["prepaid", "postpaid"]
    priority: int
    tags: list[str] = Field(default_factory=list)
    quota_per_unit: float | None = None
    latest_group_name: str | None = None
    latest_quota: int | None = None
    latest_used_quota: int | None = None
    latest_display_quota: float | None = None
    latest_display_used_quota: float | None = None
    latest_request_count: int | None = None
    today_request_count: int = 0
    last_sync_at: datetime | None = None
    last_health_status: str
    last_health_error: str | None = None
    created_at: datetime
    updated_at: datetime
    remote_user_id: int | None = None
    has_access_token: bool = False
    socks5_proxy_url: str | None = None
    proxy_mode: ProxyMode
    priority: int
    sync_interval_minutes: int
    session_expires_at: datetime | None = None


class InstanceListResponse(BaseModel):
    """Wrapper for instance listing."""

    total: int
    items: list[InstanceResponse]


class InstanceTestResponse(BaseModel):
    """Result of connectivity testing against one remote NewAPI instance."""

    success: bool
    instance_id: int
    program_type: ProgramType
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
