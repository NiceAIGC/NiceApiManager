"""Helpers for persisted runtime application settings."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
import logging

from pydantic import TypeAdapter, ValidationError
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.models import AppSetting, NotificationRuleState
from app.schemas.app_setting import (
    AppSettingsResponse,
    AppSettingsUpdateRequest,
    NotificationChannelConfig,
    NotificationRuleSet,
    build_default_notification_rules,
)
from app.services.proxy_utils import normalize_socks5_proxy_url


logger = logging.getLogger(__name__)
env_settings = get_settings()
DEFAULT_SYNC_MAX_WORKERS = 5
DEFAULT_SYNC_HISTORY_LOOKBACK_DAYS = 30
DEFAULT_SYNC_INTERVAL_MINUTES = 120
DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES = 5
_CHANNEL_LIST_ADAPTER = TypeAdapter(list[NotificationChannelConfig])
_RULE_SET_ADAPTER = TypeAdapter(NotificationRuleSet)


@dataclass(frozen=True)
class RuntimeAppSettings:
    """Effective runtime settings after applying DB overrides over env defaults."""

    sync_max_workers: int
    request_timeout: float
    sync_verify_ssl: bool
    scheduler_timezone: str
    sync_history_lookback_days: int
    default_sync_interval_minutes: int
    shared_socks5_proxy_url: str | None
    notification_enabled: bool
    notification_check_interval_minutes: int
    notification_channels: list[NotificationChannelConfig]
    notification_rules: NotificationRuleSet


def get_app_setting_record(db: Session) -> AppSetting | None:
    """Return the singleton settings row when it exists."""
    return db.scalar(select(AppSetting).order_by(AppSetting.id.asc()).limit(1))


def get_runtime_app_settings(db: Session) -> RuntimeAppSettings:
    """Return the effective runtime settings used across services."""
    row = get_app_setting_record(db)
    notification_channels = _parse_notification_channels(row.notification_channels_json if row else None)
    notification_rules = _parse_notification_rules(row.notification_rules_json if row else None)
    return RuntimeAppSettings(
        sync_max_workers=_coerce_int(
            row.sync_max_workers if row else None,
            default=DEFAULT_SYNC_MAX_WORKERS,
            minimum=1,
            maximum=32,
        ),
        request_timeout=_coerce_float(
            row.request_timeout if row else None,
            default=env_settings.request_timeout,
            minimum=0.1,
            maximum=300.0,
        ),
        sync_verify_ssl=env_settings.sync_verify_ssl if row is None or row.sync_verify_ssl is None else row.sync_verify_ssl,
        scheduler_timezone=(
            env_settings.scheduler_timezone
            if row is None or not row.scheduler_timezone
            else row.scheduler_timezone.strip()
        ),
        sync_history_lookback_days=_coerce_int(
            row.sync_history_lookback_days if row else None,
            default=DEFAULT_SYNC_HISTORY_LOOKBACK_DAYS,
            minimum=1,
            maximum=365,
        ),
        default_sync_interval_minutes=_coerce_int(
            row.default_sync_interval_minutes if row else None,
            default=DEFAULT_SYNC_INTERVAL_MINUTES,
            minimum=5,
            maximum=10080,
        ),
        shared_socks5_proxy_url=normalize_socks5_proxy_url(row.shared_socks5_proxy_url if row else None),
        notification_enabled=bool(row.notification_enabled) if row and row.notification_enabled is not None else False,
        notification_check_interval_minutes=_coerce_int(
            row.notification_check_interval_minutes if row else None,
            default=DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
            minimum=1,
            maximum=1440,
        ),
        notification_channels=notification_channels,
        notification_rules=notification_rules,
    )


def build_app_settings_response(db: Session) -> AppSettingsResponse:
    """Serialize the effective settings for API callers."""
    row = get_app_setting_record(db)
    runtime = get_runtime_app_settings(db)
    return AppSettingsResponse(
        sync_max_workers=runtime.sync_max_workers,
        request_timeout=runtime.request_timeout,
        sync_verify_ssl=runtime.sync_verify_ssl,
        scheduler_timezone=runtime.scheduler_timezone,
        sync_history_lookback_days=runtime.sync_history_lookback_days,
        default_sync_interval_minutes=runtime.default_sync_interval_minutes,
        shared_socks5_proxy_url=runtime.shared_socks5_proxy_url,
        notification_enabled=runtime.notification_enabled,
        notification_check_interval_minutes=runtime.notification_check_interval_minutes,
        notification_channels=runtime.notification_channels,
        notification_rules=runtime.notification_rules,
        created_at=row.created_at if row else None,
        updated_at=row.updated_at if row else None,
    )


def update_app_settings(db: Session, payload: AppSettingsUpdateRequest) -> AppSettingsResponse:
    """Persist runtime settings in the singleton row and return the effective view."""
    row = get_app_setting_record(db)
    if row is None:
        row = AppSetting()
        db.add(row)

    _validate_notification_channel_references(payload)

    row.sync_max_workers = payload.sync_max_workers
    row.request_timeout = payload.request_timeout
    row.sync_verify_ssl = payload.sync_verify_ssl
    row.scheduler_timezone = payload.scheduler_timezone.strip()
    row.sync_history_lookback_days = payload.sync_history_lookback_days
    row.default_sync_interval_minutes = payload.default_sync_interval_minutes
    row.shared_socks5_proxy_url = normalize_socks5_proxy_url(payload.shared_socks5_proxy_url)
    row.notification_enabled = payload.notification_enabled
    row.notification_check_interval_minutes = payload.notification_check_interval_minutes
    row.notification_channels_json = [item.model_dump(mode="json") for item in payload.notification_channels]
    row.notification_rules_json = payload.notification_rules.model_dump(mode="json")
    db.flush()
    _purge_removed_notification_states(db, payload.notification_rules)
    db.commit()
    db.refresh(row)

    return AppSettingsResponse(
        sync_max_workers=row.sync_max_workers,
        request_timeout=row.request_timeout,
        sync_verify_ssl=row.sync_verify_ssl,
        scheduler_timezone=row.scheduler_timezone,
        sync_history_lookback_days=row.sync_history_lookback_days,
        default_sync_interval_minutes=row.default_sync_interval_minutes,
        shared_socks5_proxy_url=row.shared_socks5_proxy_url,
        notification_enabled=bool(row.notification_enabled),
        notification_check_interval_minutes=row.notification_check_interval_minutes or DEFAULT_NOTIFICATION_CHECK_INTERVAL_MINUTES,
        notification_channels=_parse_notification_channels(row.notification_channels_json),
        notification_rules=_parse_notification_rules(row.notification_rules_json),
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def mark_notification_scan_completed(db: Session, completed_at: datetime) -> None:
    """Persist the timestamp of the latest monitoring pass."""
    row = get_app_setting_record(db)
    if row is None:
        row = AppSetting()
        db.add(row)
    row.notification_last_scan_at = completed_at


def get_notification_last_scan_at(db: Session) -> datetime | None:
    """Expose the most recent completed notification scan timestamp."""
    row = get_app_setting_record(db)
    return row.notification_last_scan_at if row else None


def _parse_notification_channels(value: object) -> list[NotificationChannelConfig]:
    """Validate channels stored in JSON columns while surviving legacy data."""
    if value in (None, ""):
        return []
    try:
        return _CHANNEL_LIST_ADAPTER.validate_python(value)
    except ValidationError:
        logger.warning("Invalid notification channel config detected; falling back to empty list.")
        return []


def _parse_notification_rules(value: object) -> NotificationRuleSet:
    """Validate rule sets stored in JSON columns while surviving legacy data."""
    if value in (None, ""):
        return build_default_notification_rules()
    try:
        return _RULE_SET_ADAPTER.validate_python(value)
    except ValidationError:
        logger.warning("Invalid notification rule config detected; falling back to defaults.")
        return build_default_notification_rules()


def _validate_notification_channel_references(payload: AppSettingsUpdateRequest) -> None:
    """Ensure each rule references channels that exist in the same payload."""
    channel_ids = {item.id for item in payload.notification_channels}
    for rule in payload.notification_rules.low_balance_rules:
        _assert_rule_channel_ids(rule.channel_ids, channel_ids, rule.name)
    for rule in payload.notification_rules.aggregate_balance_rules:
        _assert_rule_channel_ids(rule.channel_ids, channel_ids, rule.name)
    for rule in payload.notification_rules.connectivity_failure_rules:
        _assert_rule_channel_ids(rule.channel_ids, channel_ids, rule.name)


def _assert_rule_channel_ids(selected_channel_ids: list[str], valid_channel_ids: set[str], rule_name: str) -> None:
    """Raise a clear error when a rule points to deleted channels."""
    invalid_ids = [item for item in selected_channel_ids if item not in valid_channel_ids]
    if invalid_ids:
        raise ValueError(f"规则“{rule_name}”引用了不存在的通知渠道：{', '.join(invalid_ids)}")


def _purge_removed_notification_states(db: Session, rules: NotificationRuleSet) -> None:
    """Drop dedup state rows for rules that no longer exist."""
    active_rule_keys = {
        ("low_balance", item.id) for item in rules.low_balance_rules
    } | {
        ("aggregate_balance", item.id) for item in rules.aggregate_balance_rules
    } | {
        ("connectivity_failure", item.id) for item in rules.connectivity_failure_rules
    }

    for state in db.scalars(select(NotificationRuleState)).all():
        if (state.rule_type, state.rule_id) not in active_rule_keys:
            db.delete(state)


def _coerce_int(value: object, *, default: int, minimum: int, maximum: int) -> int:
    """Convert persisted values into a bounded integer."""
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))


def _coerce_float(value: object, *, default: float, minimum: float, maximum: float) -> float:
    """Convert persisted values into a bounded float."""
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        parsed = default
    return max(minimum, min(maximum, parsed))
