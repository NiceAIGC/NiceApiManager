"""Schemas for runtime-configurable application settings."""

from __future__ import annotations

from datetime import datetime
from uuid import uuid4
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator, model_validator


def _new_config_id(prefix: str) -> str:
    """Create stable-looking identifiers for dynamic notification configs."""
    return f"{prefix}_{uuid4().hex[:10]}"


class NotificationChannelConfig(BaseModel):
    """One outbound Apprise destination."""

    id: str = Field(default_factory=lambda: _new_config_id("channel"), min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    apprise_url: str = Field(min_length=1, max_length=2048)

    @field_validator("id")
    @classmethod
    def normalize_id(cls, value: str) -> str:
        """Store compact ids without leading/trailing whitespace."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("通知渠道 ID 不能为空。")
        return normalized

    @field_validator("name", "apprise_url")
    @classmethod
    def strip_text_fields(cls, value: str) -> str:
        """Remove accidental surrounding spaces in user-entered text."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("该字段不能为空。")
        return normalized


class BaseNotificationRule(BaseModel):
    """Common fields shared across notification rules."""

    id: str = Field(default_factory=lambda: _new_config_id("rule"), min_length=3, max_length=64)
    name: str = Field(min_length=1, max_length=80)
    enabled: bool = True
    instance_ids: list[int] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    include_disabled: bool = False
    repeat_interval_minutes: int = Field(default=180, ge=5, le=10080)
    notify_on_recovery: bool = True
    channel_ids: list[str] = Field(default_factory=list)

    @field_validator("id")
    @classmethod
    def normalize_rule_id(cls, value: str) -> str:
        """Store compact ids without leading/trailing whitespace."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("规则 ID 不能为空。")
        return normalized

    @field_validator("name")
    @classmethod
    def normalize_rule_name(cls, value: str) -> str:
        """Prevent whitespace-only rule names."""
        normalized = value.strip()
        if not normalized:
            raise ValueError("规则名称不能为空。")
        return normalized

    @field_validator("instance_ids", mode="before")
    @classmethod
    def normalize_instance_ids(cls, value: list[int] | None) -> list[int]:
        """Drop duplicates and invalid values from instance selections."""
        normalized: list[int] = []
        seen: set[int] = set()
        for raw in value or []:
            try:
                parsed = int(raw)
            except (TypeError, ValueError):
                continue
            if parsed <= 0 or parsed in seen:
                continue
            seen.add(parsed)
            normalized.append(parsed)
        return normalized

    @field_validator("tags", mode="before")
    @classmethod
    def normalize_tags(cls, value: list[str] | None) -> list[str]:
        """Drop duplicate blank tags from scope filters."""
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value or []:
            tag = str(raw).strip()
            if not tag or tag in seen:
                continue
            seen.add(tag)
            normalized.append(tag)
        return normalized

    @field_validator("channel_ids", mode="before")
    @classmethod
    def normalize_channel_ids(cls, value: list[str] | None) -> list[str]:
        """Drop duplicate blank channel ids."""
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value or []:
            channel_id = str(raw).strip()
            if not channel_id or channel_id in seen:
                continue
            seen.add(channel_id)
            normalized.append(channel_id)
        return normalized


class BalanceNotificationRule(BaseNotificationRule):
    """Per-instance low balance alert rule."""

    severity: str = Field(default="warning", pattern="^(warning|critical)$")
    threshold: float = Field(gt=0, le=1000000000)
    resolve_threshold: float | None = Field(default=None, gt=0, le=1000000000)
    min_consecutive_checks: int = Field(default=1, ge=1, le=10)

    @model_validator(mode="after")
    def validate_thresholds(self) -> "BalanceNotificationRule":
        """Ensure the recovery threshold sits above the alert threshold when configured."""
        if self.resolve_threshold is not None and self.resolve_threshold <= self.threshold:
            raise ValueError("余额恢复阈值必须大于触发阈值。")
        return self


class AggregateBalanceNotificationRule(BaseNotificationRule):
    """Alert when the combined balance of selected instances falls below a threshold."""

    severity: str = Field(default="warning", pattern="^(warning|critical)$")
    threshold: float = Field(gt=0, le=1000000000)
    resolve_threshold: float | None = Field(default=None, gt=0, le=1000000000)
    min_consecutive_checks: int = Field(default=1, ge=1, le=10)

    @model_validator(mode="after")
    def validate_targets(self) -> "AggregateBalanceNotificationRule":
        """Enabled aggregate rules must target at least one instance or tag."""
        if self.enabled and not self.instance_ids and not self.tags:
            raise ValueError("聚合余额规则启用时至少需要选择一个实例或标签。")
        if self.resolve_threshold is not None and self.resolve_threshold <= self.threshold:
            raise ValueError("聚合余额恢复阈值必须大于触发阈值。")
        return self


class ConnectivityFailureNotificationRule(BaseNotificationRule):
    """Alert when an instance repeatedly fails to connect."""

    consecutive_failures: int = Field(default=3, ge=2, le=20)


class NotificationRuleSet(BaseModel):
    """All notification rules grouped by category."""

    low_balance_rules: list[BalanceNotificationRule] = Field(default_factory=list)
    aggregate_balance_rules: list[AggregateBalanceNotificationRule] = Field(default_factory=list)
    connectivity_failure_rules: list[ConnectivityFailureNotificationRule] = Field(default_factory=list)


def build_default_notification_rules() -> NotificationRuleSet:
    """Return sensible starter rules for a fresh deployment."""
    return NotificationRuleSet(
        low_balance_rules=[
            BalanceNotificationRule(
                id="low_balance_warning_all",
                name="实例余额预警",
                severity="warning",
                threshold=50,
                resolve_threshold=80,
                repeat_interval_minutes=360,
                min_consecutive_checks=1,
            ),
            BalanceNotificationRule(
                id="low_balance_critical_all",
                name="实例余额严重不足",
                severity="critical",
                threshold=10,
                resolve_threshold=20,
                repeat_interval_minutes=120,
                min_consecutive_checks=1,
            ),
        ],
        aggregate_balance_rules=[
            AggregateBalanceNotificationRule(
                id="aggregate_balance_template",
                name="核心实例总余额",
                enabled=False,
                threshold=100,
                resolve_threshold=160,
                repeat_interval_minutes=180,
                min_consecutive_checks=1,
            )
        ],
        connectivity_failure_rules=[
            ConnectivityFailureNotificationRule(
                id="connectivity_failures_all",
                name="实例连续连接失败",
                consecutive_failures=3,
                repeat_interval_minutes=180,
            )
        ],
    )


class NotificationTestRequest(BaseModel):
    """Payload for firing a test notification."""

    channel_ids: list[str] = Field(default_factory=list)
    title: str | None = Field(default=None, max_length=120)
    body: str | None = Field(default=None, max_length=2000)

    @field_validator("channel_ids", mode="before")
    @classmethod
    def normalize_test_channel_ids(cls, value: list[str] | None) -> list[str]:
        """Drop duplicate blank channel ids."""
        normalized: list[str] = []
        seen: set[str] = set()
        for raw in value or []:
            channel_id = str(raw).strip()
            if not channel_id or channel_id in seen:
                continue
            seen.add(channel_id)
            normalized.append(channel_id)
        return normalized

    @field_validator("title", "body")
    @classmethod
    def strip_optional_text(cls, value: str | None) -> str | None:
        """Normalize optional strings while preserving empty-as-null semantics."""
        if value is None:
            return None
        normalized = value.strip()
        return normalized or None


class NotificationTestChannelResult(BaseModel):
    """Per-channel delivery result for a test message."""

    channel_id: str
    channel_name: str
    success: bool
    error_message: str | None = None


class NotificationTestResponse(BaseModel):
    """API response returned after sending a test notification."""

    success: bool
    total: int
    success_count: int
    failed_count: int
    items: list[NotificationTestChannelResult]


class AppSettingsResponse(BaseModel):
    """Effective runtime settings returned to the admin UI."""

    sync_max_workers: int = Field(ge=1, le=32)
    request_timeout: float = Field(gt=0, le=300)
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int = Field(ge=1, le=365)
    default_sync_interval_minutes: int = Field(ge=5, le=10080)
    shared_socks5_proxy_url: str | None = None
    notification_enabled: bool = False
    notification_check_interval_minutes: int = Field(default=5, ge=1, le=1440)
    notification_channels: list[NotificationChannelConfig] = Field(default_factory=list)
    notification_rules: NotificationRuleSet = Field(default_factory=build_default_notification_rules)
    created_at: datetime | None = None
    updated_at: datetime | None = None

    @field_validator("scheduler_timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        """Reject invalid IANA timezone names."""
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("无效时区，请填写标准 IANA 时区名，例如 Asia/Shanghai。") from exc
        return value


class AppSettingsUpdateRequest(BaseModel):
    """Payload used to update mutable runtime settings."""

    sync_max_workers: int = Field(ge=1, le=32)
    request_timeout: float = Field(gt=0, le=300)
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int = Field(ge=1, le=365)
    default_sync_interval_minutes: int = Field(ge=5, le=10080)
    shared_socks5_proxy_url: str | None = None
    notification_enabled: bool = False
    notification_check_interval_minutes: int = Field(default=5, ge=1, le=1440)
    notification_channels: list[NotificationChannelConfig] = Field(default_factory=list)
    notification_rules: NotificationRuleSet = Field(default_factory=build_default_notification_rules)

    @field_validator("scheduler_timezone")
    @classmethod
    def validate_timezone(cls, value: str) -> str:
        """Reject invalid IANA timezone names."""
        try:
            ZoneInfo(value)
        except ZoneInfoNotFoundError as exc:
            raise ValueError("无效时区，请填写标准 IANA 时区名，例如 Asia/Shanghai。") from exc
        return value
