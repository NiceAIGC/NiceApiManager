"""Schemas for the normalized notification center API."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator, model_validator


ChannelType = Literal["apprise", "smtp", "aliyun_sms", "aliyun_voice", "aliyun_directmail", "webhook"]
ContactType = Literal["email", "phone", "chat"]
EventType = Literal[
    "balance",
    "aggregate_balance",
    "connectivity",
    "instance_disabled",
    "instance_recovered",
    "rate_change",
    "announcement",
    "sync_failure",
    "custom",
    "test",
]
Severity = Literal["info", "warning", "critical"]


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


class NotificationScope(BaseModel):
    """Which instances a rule applies to."""

    instance_ids: list[int] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    include_disabled: bool = False

    @field_validator("instance_ids", mode="before")
    @classmethod
    def normalize_instances(cls, value: list[int] | None) -> list[int]:
        result: list[int] = []
        for raw in value or []:
            try:
                item = int(raw)
            except (TypeError, ValueError):
                continue
            if item > 0 and item not in result:
                result.append(item)
        return result

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: list[str] | None) -> list[str]:
        result: list[str] = []
        for raw in value or []:
            tag = str(raw).strip()
            if tag and tag not in result:
                result.append(tag)
        return result


class QuietHours(BaseModel):
    """Do not deliver low-severity events inside this local time window."""

    enabled: bool = False
    start: str = Field(default="22:00", pattern=r"^\d{2}:\d{2}$")
    end: str = Field(default="08:00", pattern=r"^\d{2}:\d{2}$")
    timezone: str = "Asia/Shanghai"
    allow_critical: bool = True


class NotificationCondition(BaseModel):
    """Condition payload shared by all rule types."""

    threshold: float | None = Field(default=None, gt=0, le=1_000_000_000)
    resolve_threshold: float | None = Field(default=None, gt=0, le=1_000_000_000)
    min_consecutive_checks: int = Field(default=1, ge=1, le=100)
    consecutive_failures: int = Field(default=3, ge=1, le=100)
    repeat_interval_minutes: int = Field(default=180, ge=0, le=10080)
    cooldown_minutes: int = Field(default=0, ge=0, le=10080)
    change_percent: float | None = Field(default=None, ge=0, le=1000)
    max_per_day: int | None = Field(default=None, ge=1, le=1000)
    quiet_hours: QuietHours = Field(default_factory=QuietHours)


class NotificationDelivery(BaseModel):
    """Where a matching event is delivered."""

    channel_ids: list[str] = Field(default_factory=list)
    channel_group_ids: list[str] = Field(default_factory=list)
    contact_group_ids: list[str] = Field(default_factory=list)
    template_id: str | None = None
    notify_on_recovery: bool = True

    @field_validator("channel_ids", "channel_group_ids", "contact_group_ids", mode="before")
    @classmethod
    def normalize_ids(cls, value: list[str] | None) -> list[str]:
        result: list[str] = []
        for raw in value or []:
            item = str(raw).strip()
            if item and item not in result:
                result.append(item)
        return result


class NotificationRulePayload(BaseModel):
    """Create/update payload for one alert rule."""

    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    event_type: EventType
    severity: Severity = "warning"
    scope: NotificationScope = Field(default_factory=NotificationScope)
    condition: NotificationCondition = Field(default_factory=NotificationCondition)
    delivery: NotificationDelivery = Field(default_factory=NotificationDelivery)

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("规则名称不能为空。")
        return value

    @model_validator(mode="after")
    def validate_condition(self) -> "NotificationRulePayload":
        if self.event_type in {"balance", "aggregate_balance"} and self.condition.threshold is None:
            raise ValueError("余额类规则必须填写触发阈值。")
        if self.event_type == "aggregate_balance" and not self.scope.instance_ids and not self.scope.tags:
            raise ValueError("聚合余额规则至少需要选择一个实例或标签。")
        if (
            self.condition.resolve_threshold is not None
            and self.condition.threshold is not None
            and self.condition.resolve_threshold <= self.condition.threshold
        ):
            raise ValueError("恢复阈值必须大于触发阈值。")
        return self


class NotificationRuleResponse(NotificationRulePayload):
    """Stored rule with server-generated identity and timestamps."""

    id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NotificationChannelPayload(BaseModel):
    """Create/update payload for one delivery channel."""

    id: str | None = Field(default=None, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    type: ChannelType
    enabled: bool = True
    config: dict[str, Any] = Field(default_factory=dict)
    secrets: dict[str, Any] = Field(default_factory=dict)

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str | None) -> str | None:
        return value.strip() if value and value.strip() else None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("渠道名称不能为空。")
        return value


class NotificationChannelResponse(BaseModel):
    """Public channel view. Secret values are never serialized."""

    id: str
    name: str
    type: ChannelType
    enabled: bool
    config: dict[str, Any] = Field(default_factory=dict)
    has_secrets: bool = False
    secret_fields: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NotificationChannelGroupPayload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    channel_ids: list[str] = Field(default_factory=list)


class NotificationChannelGroupResponse(NotificationChannelGroupPayload):
    id: str
    created_at: datetime | None = None


class NotificationContactPayload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    type: ContactType
    value: str = Field(min_length=1, max_length=255)
    enabled: bool = True
    labels: list[str] = Field(default_factory=list)

    @field_validator("value")
    @classmethod
    def normalize_value(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("联系方式不能为空。")
        return value

    @model_validator(mode="after")
    def validate_value(self) -> "NotificationContactPayload":
        if self.type == "email" and "@" not in self.value:
            raise ValueError("邮箱地址格式不正确。")
        if self.type == "phone" and not all(char in "+0123456789- " for char in self.value):
            raise ValueError("手机号只能包含数字、空格、+ 和 -。")
        return self


class NotificationContactResponse(NotificationContactPayload):
    id: str
    labels: list[str] = Field(default_factory=list)
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NotificationContactGroupPayload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    contact_ids: list[str] = Field(default_factory=list)


class NotificationContactGroupResponse(NotificationContactGroupPayload):
    id: str
    created_at: datetime | None = None


class NotificationTemplatePayload(BaseModel):
    id: str | None = None
    name: str = Field(min_length=1, max_length=80)
    channel_type: str = Field(default="generic", max_length=32)
    subject_template: str | None = Field(default=None, max_length=255)
    body_template: str = Field(min_length=1)
    provider_template_code: str | None = Field(default=None, max_length=128)
    param_map: dict[str, str] = Field(default_factory=dict)


class NotificationTemplateResponse(NotificationTemplatePayload):
    id: str
    created_at: datetime | None = None
    updated_at: datetime | None = None


class NotificationTestPayload(BaseModel):
    channel_ids: list[str] = Field(default_factory=list)
    channel_group_ids: list[str] = Field(default_factory=list)
    contact_group_ids: list[str] = Field(default_factory=list)
    template_id: str | None = None
    title: str | None = Field(default=None, max_length=120)
    body: str | None = Field(default=None, max_length=2000)
    event_type: EventType = "test"
    severity: Severity = "info"
    context: dict[str, Any] = Field(default_factory=dict)


class CustomEventPayload(BaseModel):
    """Generic alert event accepted from external systems."""

    event_type: str = Field(default="custom", min_length=1, max_length=32)
    severity: Severity = "warning"
    title: str = Field(min_length=1, max_length=255)
    body: str | None = Field(default=None, max_length=10000)
    instance_id: int | None = None
    fields: dict[str, Any] = Field(default_factory=dict)
    dedupe_key: str | None = Field(default=None, max_length=128)
    channel_ids: list[str] = Field(default_factory=list)
    channel_group_ids: list[str] = Field(default_factory=list)
    contact_group_ids: list[str] = Field(default_factory=list)
    template_id: str | None = None


class NotificationChannelHealth(BaseModel):
    id: str
    name: str
    type: str
    enabled: bool
    last_status: str | None = None
    last_error: str | None = None
    last_sent_at: datetime | None = None


class NotificationOverviewResponse(BaseModel):
    active_alerts: int = 0
    enabled_rules: int = 0
    enabled_channels: int = 0
    success_24h: int = 0
    failed_24h: int = 0
    last_scan_at: datetime | None = None
    next_scan_at: datetime | None = None
    channels: list[NotificationChannelHealth] = Field(default_factory=list)


class NotificationDeliveryResponse(BaseModel):
    id: int
    instance_id: int | None = None
    instance_name: str | None = None
    rule_name: str | None = None
    event_type: str
    source_type: str
    title: str
    body: str | None = None
    delivery_status: str
    channels: list[dict[str, Any]] = Field(default_factory=list)
    error_message: str | None = None
    created_at: datetime


class NotificationDeliveryListResponse(BaseModel):
    total: int
    items: list[NotificationDeliveryResponse]
