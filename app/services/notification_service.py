"""Apprise-backed notification delivery and rule evaluation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
import logging
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.time import utcnow
from app.models import Instance, NotificationLog, NotificationRuleState, SyncRun
from app.schemas.app_setting import (
    AggregateBalanceNotificationRule,
    BalanceNotificationRule,
    ConnectivityFailureNotificationRule,
    NotificationChannelConfig,
    NotificationTestChannelResult,
    NotificationTestRequest,
    NotificationTestResponse,
)
from app.services.app_setting_service import (
    get_notification_last_scan_at,
    get_runtime_app_settings,
    mark_notification_scan_completed,
)


logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class _ConnectivitySummary:
    """Latest consecutive sync failure state for one instance."""

    streak: int
    last_status: str | None
    last_error: str | None


@dataclass(frozen=True)
class _NotificationDispatchContext:
    """Metadata captured for one notification event."""

    source_type: str
    event_type: str
    title: str
    body: str
    notify_type: str
    rule_type: str | None = None
    rule_id: str | None = None
    rule_name: str | None = None
    instance_id: int | None = None
    target_key: str | None = None


def send_test_notification(db: Session, payload: NotificationTestRequest) -> NotificationTestResponse:
    """Fire a sample notification through the selected Apprise channels."""
    runtime_settings = get_runtime_app_settings(db)
    channels = _resolve_channels(
        runtime_settings.notification_channels,
        selected_channel_ids=payload.channel_ids,
    )
    if not channels:
        raise ValueError("没有可用的已启用通知渠道，请先保存至少一个启用状态的 Apprise 渠道。")

    title = payload.title or "NiceApiManager 测试通知"
    body = payload.body or (
        "这是一条测试消息。\n"
        "如果你收到了它，说明当前 Apprise 通知渠道配置可用。"
    )
    items = _deliver_message(channels, title=title, body=body, notify_type="info")
    _create_notification_log(
        db,
        context=_NotificationDispatchContext(
            source_type="test",
            event_type="test",
            title=title,
            body=body,
            notify_type="info",
        ),
        results=items,
    )
    db.commit()
    success_count = sum(1 for item in items if item.success)
    return NotificationTestResponse(
        success=success_count > 0,
        total=len(items),
        success_count=success_count,
        failed_count=len(items) - success_count,
        items=items,
    )


def run_notification_monitoring_pass() -> None:
    """Evaluate all configured notification rules on a fixed scheduler tick."""
    with SessionLocal() as db:
        try:
            runtime_settings = get_runtime_app_settings(db)
            if not runtime_settings.notification_enabled:
                return

            enabled_channels = [item for item in runtime_settings.notification_channels if item.enabled]
            if not enabled_channels:
                return

            now = utcnow()
            last_scan_at = get_notification_last_scan_at(db)
            if (
                last_scan_at is not None
                and now < last_scan_at + timedelta(minutes=runtime_settings.notification_check_interval_minutes)
            ):
                return

            instances = db.scalars(select(Instance).order_by(Instance.id.asc())).all()
            connectivity = _build_connectivity_summary(
                db,
                instance_ids=[item.id for item in instances],
            )

            _evaluate_low_balance_rules(db, instances=instances, now=now)
            _evaluate_aggregate_balance_rules(db, instances=instances, now=now)
            _evaluate_connectivity_failure_rules(
                db,
                instances=instances,
                connectivity=connectivity,
                now=now,
            )

            mark_notification_scan_completed(db, now)
            db.commit()
        except Exception:
            db.rollback()
            logger.exception("Notification monitoring pass failed")


def _evaluate_low_balance_rules(db: Session, *, instances: list[Instance], now) -> None:
    """Evaluate per-instance balance thresholds."""
    runtime_settings = get_runtime_app_settings(db)
    for rule in runtime_settings.notification_rules.low_balance_rules:
        state_map = _load_rule_states(db, rule_type="low_balance", rule_id=rule.id)
        seen_target_keys: set[str] = set()
        channels = _resolve_channels(runtime_settings.notification_channels, selected_channel_ids=rule.channel_ids)

        for instance in instances:
            if not _instance_matches_rule(instance, rule):
                continue
            if instance.billing_mode != "prepaid":
                continue

            balance = instance.latest_display_quota
            target_key = f"instance:{instance.id}"
            seen_target_keys.add(target_key)
            state = state_map.get(target_key) or _create_rule_state(
                db,
                rule_type="low_balance",
                rule_id=rule.id,
                target_key=target_key,
            )

            is_active = balance is not None and balance <= rule.threshold
            is_resolved = balance is not None and balance >= _resolve_threshold(rule)
            title = _build_low_balance_title(rule, instance, balance)
            body = _build_low_balance_body(rule, instance, balance, now)
            recovery_title = f"【余额恢复】{instance.name}"
            recovery_body = (
                f"规则：{rule.name}\n"
                f"实例：{instance.name}\n"
                f"当前余额：{_format_amount(balance)}\n"
                f"恢复阈值：{_format_amount(_resolve_threshold(rule))}\n"
                f"站点：{instance.base_url}\n"
                f"时间：{now.isoformat()}"
            )

            _apply_state_transition(
                db=db,
                state=state,
                is_active=is_active,
                is_resolved=is_resolved,
                current_value=_format_amount(balance),
                threshold_hits_required=rule.min_consecutive_checks,
                repeat_interval_minutes=rule.repeat_interval_minutes,
                notify_on_recovery=rule.notify_on_recovery,
                alert_channels=channels,
                alert_title=title,
                alert_body=body,
                alert_notify_type="failure" if rule.severity == "critical" else "warning",
                recovery_title=recovery_title,
                recovery_body=recovery_body,
                recovery_notify_type="success",
                now=now,
                alert_context=_NotificationDispatchContext(
                    source_type="rule",
                    event_type="alert",
                    title=title,
                    body=body,
                    notify_type="failure" if rule.severity == "critical" else "warning",
                    rule_type="low_balance",
                    rule_id=rule.id,
                    rule_name=rule.name,
                    instance_id=instance.id,
                    target_key=target_key,
                ),
                recovery_context=_NotificationDispatchContext(
                    source_type="rule",
                    event_type="recovery",
                    title=recovery_title,
                    body=recovery_body,
                    notify_type="success",
                    rule_type="low_balance",
                    rule_id=rule.id,
                    rule_name=rule.name,
                    instance_id=instance.id,
                    target_key=target_key,
                ),
            )

        _delete_stale_rule_states(db, state_map, seen_target_keys)


def _evaluate_aggregate_balance_rules(db: Session, *, instances: list[Instance], now) -> None:
    """Evaluate combined-balance thresholds across selected instance groups."""
    runtime_settings = get_runtime_app_settings(db)
    for rule in runtime_settings.notification_rules.aggregate_balance_rules:
        state_map = _load_rule_states(db, rule_type="aggregate_balance", rule_id=rule.id)
        if not rule.enabled:
            _delete_stale_rule_states(db, state_map, set())
            continue

        matched_instances = [
            item for item in instances if _instance_matches_rule(item, rule) and item.billing_mode == "prepaid"
        ]
        if not matched_instances:
            _delete_stale_rule_states(db, state_map, set())
            continue

        target_key = "aggregate"
        seen_target_keys = {target_key}
        state = state_map.get(target_key) or _create_rule_state(
            db,
            rule_type="aggregate_balance",
            rule_id=rule.id,
            target_key=target_key,
        )
        channels = _resolve_channels(runtime_settings.notification_channels, selected_channel_ids=rule.channel_ids)
        total_balance = sum((item.latest_display_quota or 0) for item in matched_instances)
        is_active = total_balance <= rule.threshold
        is_resolved = total_balance >= _resolve_threshold(rule)

        title = f"【聚合余额{_severity_label(rule.severity)}】{rule.name}"
        body = _build_aggregate_balance_body(rule, matched_instances, total_balance, now)
        recovery_title = f"【聚合余额恢复】{rule.name}"
        recovery_body = (
            f"规则：{rule.name}\n"
            f"当前总余额：{_format_amount(total_balance)}\n"
            f"恢复阈值：{_format_amount(_resolve_threshold(rule))}\n"
            f"覆盖实例数：{len(matched_instances)}\n"
            f"时间：{now.isoformat()}"
        )

        _apply_state_transition(
            db=db,
            state=state,
            is_active=is_active,
            is_resolved=is_resolved,
            current_value=_format_amount(total_balance),
            threshold_hits_required=rule.min_consecutive_checks,
            repeat_interval_minutes=rule.repeat_interval_minutes,
            notify_on_recovery=rule.notify_on_recovery,
            alert_channels=channels,
            alert_title=title,
            alert_body=body,
            alert_notify_type="failure" if rule.severity == "critical" else "warning",
            recovery_title=recovery_title,
            recovery_body=recovery_body,
            recovery_notify_type="success",
            now=now,
            alert_context=_NotificationDispatchContext(
                source_type="rule",
                event_type="alert",
                title=title,
                body=body,
                notify_type="failure" if rule.severity == "critical" else "warning",
                rule_type="aggregate_balance",
                rule_id=rule.id,
                rule_name=rule.name,
                target_key=target_key,
            ),
            recovery_context=_NotificationDispatchContext(
                source_type="rule",
                event_type="recovery",
                title=recovery_title,
                body=recovery_body,
                notify_type="success",
                rule_type="aggregate_balance",
                rule_id=rule.id,
                rule_name=rule.name,
                target_key=target_key,
            ),
        )
        _delete_stale_rule_states(db, state_map, seen_target_keys)


def _evaluate_connectivity_failure_rules(
    db: Session,
    *,
    instances: list[Instance],
    connectivity: dict[int, _ConnectivitySummary],
    now,
) -> None:
    """Evaluate consecutive sync failure rules per instance."""
    runtime_settings = get_runtime_app_settings(db)
    for rule in runtime_settings.notification_rules.connectivity_failure_rules:
        state_map = _load_rule_states(db, rule_type="connectivity_failure", rule_id=rule.id)
        seen_target_keys: set[str] = set()
        channels = _resolve_channels(runtime_settings.notification_channels, selected_channel_ids=rule.channel_ids)

        for instance in instances:
            if not _instance_matches_rule(instance, rule):
                continue

            target_key = f"instance:{instance.id}"
            seen_target_keys.add(target_key)
            state = state_map.get(target_key) or _create_rule_state(
                db,
                rule_type="connectivity_failure",
                rule_id=rule.id,
                target_key=target_key,
            )
            item = connectivity.get(instance.id, _ConnectivitySummary(streak=0, last_status=None, last_error=None))
            is_active = rule.enabled and item.streak >= rule.consecutive_failures
            is_resolved = item.streak == 0 and item.last_status == "success"
            title = f"【连续连接失败】{instance.name}"
            body = (
                f"规则：{rule.name}\n"
                f"实例：{instance.name}\n"
                f"连续失败次数：{item.streak}\n"
                f"触发阈值：{rule.consecutive_failures}\n"
                f"最近错误：{item.last_error or '-'}\n"
                f"站点：{instance.base_url}\n"
                f"时间：{now.isoformat()}"
            )
            recovery_title = f"【连接恢复】{instance.name}"
            recovery_body = (
                f"规则：{rule.name}\n"
                f"实例：{instance.name}\n"
                f"最近同步状态已恢复成功。\n"
                f"站点：{instance.base_url}\n"
                f"时间：{now.isoformat()}"
            )

            _apply_state_transition(
                db=db,
                state=state,
                is_active=is_active,
                is_resolved=is_resolved,
                current_value=str(item.streak),
                threshold_hits_required=1,
                repeat_interval_minutes=rule.repeat_interval_minutes,
                notify_on_recovery=rule.notify_on_recovery,
                alert_channels=channels,
                alert_title=title,
                alert_body=body,
                alert_notify_type="failure",
                recovery_title=recovery_title,
                recovery_body=recovery_body,
                recovery_notify_type="success",
                now=now,
                alert_context=_NotificationDispatchContext(
                    source_type="rule",
                    event_type="alert",
                    title=title,
                    body=body,
                    notify_type="failure",
                    rule_type="connectivity_failure",
                    rule_id=rule.id,
                    rule_name=rule.name,
                    instance_id=instance.id,
                    target_key=target_key,
                ),
                recovery_context=_NotificationDispatchContext(
                    source_type="rule",
                    event_type="recovery",
                    title=recovery_title,
                    body=recovery_body,
                    notify_type="success",
                    rule_type="connectivity_failure",
                    rule_id=rule.id,
                    rule_name=rule.name,
                    instance_id=instance.id,
                    target_key=target_key,
                ),
            )

        _delete_stale_rule_states(db, state_map, seen_target_keys)


def _apply_state_transition(
    *,
    db: Session,
    state: NotificationRuleState,
    is_active: bool,
    is_resolved: bool,
    current_value: str,
    threshold_hits_required: int,
    repeat_interval_minutes: int,
    notify_on_recovery: bool,
    alert_channels: list[NotificationChannelConfig],
    alert_title: str,
    alert_body: str,
    alert_notify_type: str,
    recovery_title: str,
    recovery_body: str,
    recovery_notify_type: str,
    now,
    alert_context: _NotificationDispatchContext,
    recovery_context: _NotificationDispatchContext,
) -> None:
    """Apply dedup, cooldown, and recovery rules around one state row."""
    state.last_value = current_value
    state.last_evaluated_at = now

    if is_active:
        state.consecutive_hits += 1
        if state.status != "alerting":
            if state.consecutive_hits < threshold_hits_required:
                return
            results = _deliver_message(
                alert_channels,
                title=alert_title,
                body=alert_body,
                notify_type=alert_notify_type,
            )
            _create_notification_log(db, context=alert_context, results=results)
            if _has_successful_delivery(results):
                state.status = "alerting"
                state.last_triggered_at = now
            return

        if _is_repeat_due(state.last_triggered_at, repeat_interval_minutes, now):
            results = _deliver_message(
                alert_channels,
                title=alert_title,
                body=alert_body,
                notify_type=alert_notify_type,
            )
            _create_notification_log(db, context=alert_context, results=results)
            if _has_successful_delivery(results):
                state.last_triggered_at = now
        return

    state.consecutive_hits = 0
    if is_resolved:
        if state.status == "alerting":
            delivered = True
            if notify_on_recovery:
                results = _deliver_message(
                    alert_channels,
                    title=recovery_title,
                    body=recovery_body,
                    notify_type=recovery_notify_type,
                )
                _create_notification_log(db, context=recovery_context, results=results)
                delivered = _has_successful_delivery(results)
            if delivered:
                state.status = "normal"
                state.last_resolved_at = now
        else:
            state.status = "normal"


def _load_rule_states(db: Session, *, rule_type: str, rule_id: str) -> dict[str, NotificationRuleState]:
    """Return existing state rows for one notification rule."""
    return {
        item.target_key: item
        for item in db.scalars(
            select(NotificationRuleState).where(
                NotificationRuleState.rule_type == rule_type,
                NotificationRuleState.rule_id == rule_id,
            )
        ).all()
    }


def _create_rule_state(db: Session, *, rule_type: str, rule_id: str, target_key: str) -> NotificationRuleState:
    """Create a new state row for first-time rule evaluation."""
    state = NotificationRuleState(
        rule_type=rule_type,
        rule_id=rule_id,
        target_key=target_key,
    )
    db.add(state)
    return state


def _delete_stale_rule_states(
    db: Session,
    existing_states: dict[str, NotificationRuleState],
    active_target_keys: set[str],
) -> None:
    """Delete dedup rows whose targets are no longer monitored by the rule."""
    for target_key, state in existing_states.items():
        if target_key not in active_target_keys:
            db.delete(state)


def _build_connectivity_summary(db: Session, *, instance_ids: list[int]) -> dict[int, _ConnectivitySummary]:
    """Count the latest consecutive failed sync runs for each instance."""
    if not instance_ids:
        return {}

    rows = db.execute(
        select(
            SyncRun.instance_id,
            SyncRun.status,
            SyncRun.error_message,
        )
        .where(
            SyncRun.instance_id.in_(instance_ids),
            SyncRun.status.in_(("success", "failed")),
        )
        .order_by(SyncRun.instance_id.asc(), SyncRun.started_at.desc(), SyncRun.id.desc())
    ).all()

    summary: dict[int, _ConnectivitySummary] = {}
    finished_instance_ids: set[int] = set()
    running: dict[int, dict[str, str | int | None]] = {}
    for instance_id, status, error_message in rows:
        if instance_id in finished_instance_ids:
            continue
        current = running.setdefault(
            instance_id,
            {
                "streak": 0,
                "last_status": status,
                "last_error": error_message,
            },
        )
        if status == "failed":
            current["streak"] = int(current["streak"] or 0) + 1
            if not current["last_error"]:
                current["last_error"] = error_message
            continue

        finished_instance_ids.add(instance_id)

    for instance_id in instance_ids:
        current = running.get(instance_id)
        if current is None:
            summary[instance_id] = _ConnectivitySummary(streak=0, last_status=None, last_error=None)
            continue
        summary[instance_id] = _ConnectivitySummary(
            streak=int(current["streak"] or 0),
            last_status=str(current["last_status"]) if current["last_status"] is not None else None,
            last_error=str(current["last_error"]) if current["last_error"] is not None else None,
        )
    return summary


def _instance_matches_rule(
    instance: Instance,
    rule: BalanceNotificationRule | AggregateBalanceNotificationRule | ConnectivityFailureNotificationRule,
) -> bool:
    """Apply instance-id, tag, and enabled filters shared by all notification rules."""
    if not rule.enabled:
        return False
    if not rule.include_disabled and not instance.enabled:
        return False

    matches_instance_id = instance.id in rule.instance_ids if rule.instance_ids else False
    instance_tags = set(instance.tags_json or [])
    matches_tag = bool(instance_tags.intersection(rule.tags)) if rule.tags else False

    if rule.instance_ids and rule.tags:
        return matches_instance_id or matches_tag
    if rule.instance_ids:
        return matches_instance_id
    if rule.tags:
        return matches_tag
    return True


def _resolve_channels(
    channels: list[NotificationChannelConfig],
    *,
    selected_channel_ids: list[str],
) -> list[NotificationChannelConfig]:
    """Pick enabled channels for one rule. Empty selections mean all enabled channels."""
    enabled_channels = [item for item in channels if item.enabled]
    if not selected_channel_ids:
        return enabled_channels
    selected = set(selected_channel_ids)
    return [item for item in enabled_channels if item.id in selected]


def _deliver_message(
    channels: list[NotificationChannelConfig],
    *,
    title: str,
    body: str,
    notify_type: str,
) -> list[NotificationTestChannelResult]:
    """Deliver a message to all selected channels and return per-channel outcomes."""
    results: list[NotificationTestChannelResult] = []
    for channel in channels:
        try:
            delivered = _send_via_apprise(
                channel.apprise_url,
                title=title,
                body=body,
                notify_type=notify_type,
            )
            if not delivered:
                raise RuntimeError("Apprise 返回发送失败。")
            results.append(
                NotificationTestChannelResult(
                    channel_id=channel.id,
                    channel_name=channel.name,
                    success=True,
                )
            )
        except Exception as exc:  # pragma: no cover - network dependent
            logger.warning("Notification delivery failed for channel %s: %s", channel.id, exc)
            results.append(
                NotificationTestChannelResult(
                    channel_id=channel.id,
                    channel_name=channel.name,
                    success=False,
                    error_message=str(exc),
                )
            )
    return results


def _has_successful_delivery(results: list[NotificationTestChannelResult]) -> bool:
    """Return whether at least one selected channel accepted the message."""
    return any(item.success for item in results)


def _create_notification_log(
    db: Session,
    *,
    context: _NotificationDispatchContext,
    results: list[NotificationTestChannelResult],
) -> None:
    """Persist one notification event and all per-channel outcomes."""
    success_count = sum(1 for item in results if item.success)
    failed_items = [item for item in results if not item.success]
    if success_count and failed_items:
        delivery_status = "partial"
    elif success_count:
        delivery_status = "success"
    else:
        delivery_status = "failed"

    db.add(
        NotificationLog(
            instance_id=context.instance_id,
            rule_type=context.rule_type,
            rule_id=context.rule_id,
            rule_name=context.rule_name,
            event_type=context.event_type,
            source_type=context.source_type,
            target_key=context.target_key,
            title=context.title,
            body=context.body,
            notify_type=context.notify_type,
            delivery_status=delivery_status,
            channels_json=[item.model_dump(mode="json") for item in results],
            error_message="；".join(
                f"{item.channel_name}: {item.error_message or '发送失败'}"
                for item in failed_items
            )
            or None,
        )
    )


def _send_via_apprise(apprise_url: str, *, title: str, body: str, notify_type: str) -> bool:
    """Send one message through Apprise while keeping import errors localized."""
    try:
        import apprise
    except ImportError as exc:  # pragma: no cover - depends on environment
        raise RuntimeError("Apprise 依赖未安装，请重新构建环境后再使用通知功能。") from exc

    app = apprise.Apprise()
    if not app.add(apprise_url):
        raise ValueError("无效的 Apprise URL。")
    notify_type_value = {
        "info": apprise.NotifyType.INFO,
        "warning": apprise.NotifyType.WARNING,
        "failure": apprise.NotifyType.FAILURE,
        "success": apprise.NotifyType.SUCCESS,
    }.get(notify_type, apprise.NotifyType.INFO)
    return bool(app.notify(title=title, body=body, notify_type=notify_type_value))


def _build_low_balance_title(rule: BalanceNotificationRule, instance: Instance, balance: float | None) -> str:
    """Format the notification title for one low-balance event."""
    return f"【余额{_severity_label(rule.severity)}】{instance.name} 当前 {_format_amount(balance)}"


def _build_low_balance_body(rule: BalanceNotificationRule, instance: Instance, balance: float | None, now) -> str:
    """Format the notification body for one low-balance event."""
    tags = "、".join(instance.tags_json or []) or "-"
    return (
        f"规则：{rule.name}\n"
        f"实例：{instance.name}\n"
        f"当前余额：{_format_amount(balance)}\n"
        f"触发阈值：{_format_amount(rule.threshold)}\n"
        f"恢复阈值：{_format_amount(_resolve_threshold(rule))}\n"
        f"标签：{tags}\n"
        f"站点：{instance.base_url}\n"
        f"时间：{now.isoformat()}"
    )


def _build_aggregate_balance_body(
    rule: AggregateBalanceNotificationRule,
    matched_instances: list[Instance],
    total_balance: float,
    now,
) -> str:
    """Format the aggregate-balance alert body."""
    ranked = sorted(
        matched_instances,
        key=lambda item: item.latest_display_quota or 0,
    )
    top_lines = [
        f"- {item.name}: {_format_amount(item.latest_display_quota)}"
        for item in ranked[:10]
    ] or ["- 无可用预付费实例"]
    return (
        f"规则：{rule.name}\n"
        f"当前总余额：{_format_amount(total_balance)}\n"
        f"触发阈值：{_format_amount(rule.threshold)}\n"
        f"恢复阈值：{_format_amount(_resolve_threshold(rule))}\n"
        f"覆盖实例数：{len(matched_instances)}\n"
        f"实例明细：\n"
        f"{chr(10).join(top_lines)}\n"
        f"时间：{now.isoformat()}"
    )


def _resolve_threshold(rule: BalanceNotificationRule | AggregateBalanceNotificationRule) -> float:
    """Return the effective recovery threshold with a sane default gap."""
    if rule.resolve_threshold is not None:
        return rule.resolve_threshold
    return round(rule.threshold * 1.2, 2)


def _is_repeat_due(last_triggered_at, repeat_interval_minutes: int, now) -> bool:
    """Return whether an already-alerting rule should send another reminder."""
    if last_triggered_at is None:
        return True
    return now >= last_triggered_at + timedelta(minutes=repeat_interval_minutes)


def _severity_label(severity: str) -> str:
    """Human-readable severity text for titles."""
    return "严重" if severity == "critical" else "预警"


def _format_amount(value: float | None) -> str:
    """Render notification numeric values consistently."""
    if value is None:
        return "-"
    return f"{value:.2f}"
