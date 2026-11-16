"""Read/write helpers for the normalized notification center."""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any
from uuid import uuid4

from fastapi import HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import (
    AppSetting,
    Instance,
    NotificationChannel,
    NotificationChannelGroup,
    NotificationChannelGroupMember,
    NotificationContact,
    NotificationContactGroup,
    NotificationContactGroupMember,
    NotificationLog,
    NotificationRule,
    NotificationRuleState,
    NotificationTemplate,
)
from app.schemas.app_setting import NotificationTestChannelResult, NotificationTestResponse
from app.schemas.notification import (
    CustomEventPayload,
    NotificationChannelHealth,
    NotificationChannelGroupPayload,
    NotificationChannelGroupResponse,
    NotificationChannelPayload,
    NotificationChannelResponse,
    NotificationContactGroupPayload,
    NotificationContactGroupResponse,
    NotificationContactPayload,
    NotificationContactResponse,
    NotificationDeliveryListResponse,
    NotificationDeliveryResponse,
    NotificationOverviewResponse,
    NotificationRulePayload,
    NotificationRuleResponse,
    NotificationTemplatePayload,
    NotificationTemplateResponse,
    NotificationTestPayload,
)
from app.services.app_setting_service import get_app_setting_record, get_runtime_app_settings
from app.services.notification_log_service import list_notification_logs
from app.services.notification_providers import ProviderMessage, send_via_channel
from app.services.notification_service import (
    _NotificationDispatchContext,
    _create_notification_log,
    _deliver_message,
    _is_quiet_time,
    _resolve_channels,
    resolve_contact_group_recipients,
)


logger = logging.getLogger(__name__)
_SECRET_KEYS = {
    "apprise": {"apprise_url"},
    "smtp": {"password"},
    "aliyun_sms": {"access_key_id", "access_key_secret"},
    "aliyun_voice": {"access_key_id", "access_key_secret"},
    "aliyun_directmail": {"access_key_id", "access_key_secret"},
    "webhook": {"url", "secret"},
}
_REQUIRED_CONFIG = {
    "smtp": ("host", "from_address"),
    "aliyun_sms": ("sign_name", "template_code"),
    "aliyun_voice": ("tts_code",),
    "aliyun_directmail": ("account_name", "from_alias"),
}


def _new_id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex[:10]}"


def _ensure_v2_marker(db: Session) -> None:
    """Create the singleton settings row and mark normalized storage active."""
    row = get_app_setting_record(db)
    if row is None:
        row = AppSetting()
        db.add(row)
    if row.notification_center_v2_at is None:
        row.notification_center_v2_at = utcnow()


def _json_load(value: str | None) -> dict[str, Any]:
    if not value:
        return {}
    try:
        parsed = json.loads(value)
        return parsed if isinstance(parsed, dict) else {}
    except (TypeError, ValueError):
        return {}


def _validate_channel_payload(
    channel_type: str,
    config: dict[str, Any],
    secrets: dict[str, Any],
) -> None:
    if channel_type == "apprise" and not str(secrets.get("apprise_url") or "").strip():
        raise HTTPException(status_code=422, detail="Apprise 渠道需要填写 Apprise URL。")
    required = _REQUIRED_CONFIG.get(channel_type, ())
    missing = [key for key in required if not str(config.get(key, "")).strip()]
    if missing:
        raise HTTPException(status_code=422, detail=f"缺少必填配置：{', '.join(missing)}")
    if channel_type.startswith("aliyun_"):
        for key in ("access_key_id", "access_key_secret"):
            if not str(secrets.get(key) or "").strip():
                raise HTTPException(status_code=422, detail="阿里云渠道需要填写 AccessKey ID 和 Secret。")
    if channel_type == "webhook" and not str(secrets.get("url") or config.get("url") or "").strip():
        raise HTTPException(status_code=422, detail="Webhook 渠道需要填写 URL。")


def _channel_response(channel: NotificationChannel) -> NotificationChannelResponse:
    secrets = _json_load(channel.secrets_json)
    config = dict(channel.config_json or {})
    if channel.type != "webhook":
        config.pop("url", None)
    return NotificationChannelResponse(
        id=channel.id,
        name=channel.name,
        type=channel.type,  # type: ignore[arg-type]
        enabled=channel.enabled,
        config=config,
        has_secrets=bool(secrets),
        secret_fields=sorted(secrets.keys()),
        created_at=channel.created_at,
        updated_at=channel.updated_at,
    )


def list_channels(db: Session) -> list[NotificationChannelResponse]:
    rows = db.scalars(select(NotificationChannel).order_by(NotificationChannel.name.asc())).all()
    return [_channel_response(row) for row in rows]


def create_channel(db: Session, payload: NotificationChannelPayload) -> NotificationChannelResponse:
    channel_type = payload.type
    secrets = {key: value for key, value in payload.secrets.items() if str(value).strip()}
    _validate_channel_payload(channel_type, payload.config, secrets)
    channel = NotificationChannel(
        id=payload.id or _new_id("channel"),
        name=payload.name,
        type=channel_type,
        enabled=payload.enabled,
        config_json=payload.config,
        secrets_json=json.dumps(secrets, ensure_ascii=False),
    )
    db.add(channel)
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(channel)
    return _channel_response(channel)


def update_channel(db: Session, channel_id: str, payload: NotificationChannelPayload) -> NotificationChannelResponse:
    channel = db.get(NotificationChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="通知渠道不存在。")
    existing_secrets = _json_load(channel.secrets_json)
    allowed = _SECRET_KEYS.get(payload.type, set())
    merged_secrets = {key: value for key, value in existing_secrets.items() if key in allowed}
    for key, value in payload.secrets.items():
        if key not in allowed:
            continue
        if value in (None, ""):
            merged_secrets.pop(key, None)
        else:
            merged_secrets[key] = value
    _validate_channel_payload(payload.type, payload.config, merged_secrets)
    channel.name = payload.name
    channel.type = payload.type
    channel.enabled = payload.enabled
    channel.config_json = payload.config
    channel.secrets_json = json.dumps(merged_secrets, ensure_ascii=False)
    db.commit()
    db.refresh(channel)
    return _channel_response(channel)


def delete_channel(db: Session, channel_id: str) -> None:
    channel = db.get(NotificationChannel, channel_id)
    if channel is None:
        raise HTTPException(status_code=404, detail="通知渠道不存在。")
    db.execute(delete(NotificationChannelGroupMember).where(NotificationChannelGroupMember.channel_id == channel_id))
    db.delete(channel)
    db.commit()


def list_channel_groups(db: Session) -> list[NotificationChannelGroupResponse]:
    groups = db.scalars(select(NotificationChannelGroup).order_by(NotificationChannelGroup.name.asc())).all()
    members = db.scalars(select(NotificationChannelGroupMember)).all()
    by_group: dict[str, list[str]] = {}
    for member in members:
        by_group.setdefault(member.group_id, []).append(member.channel_id)
    return [
        NotificationChannelGroupResponse(
            id=group.id,
            name=group.name,
            channel_ids=by_group.get(group.id, []),
            created_at=group.created_at,
        )
        for group in groups
    ]


def create_channel_group(db: Session, payload: NotificationChannelGroupPayload) -> NotificationChannelGroupResponse:
    group_id = payload.id or _new_id("group")
    group = NotificationChannelGroup(id=group_id, name=payload.name.strip())
    db.add(group)
    valid_ids: list[str] = []
    for channel_id in payload.channel_ids:
        if db.get(NotificationChannel, channel_id) is None:
            continue
        valid_ids.append(channel_id)
        db.add(NotificationChannelGroupMember(group_id=group_id, channel_id=channel_id))
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(group)
    return NotificationChannelGroupResponse(id=group.id, name=group.name, channel_ids=valid_ids, created_at=group.created_at)


def update_channel_group(db: Session, group_id: str, payload: NotificationChannelGroupPayload) -> NotificationChannelGroupResponse:
    group = db.get(NotificationChannelGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="渠道分组不存在。")
    group.name = payload.name.strip()
    db.execute(delete(NotificationChannelGroupMember).where(NotificationChannelGroupMember.group_id == group_id))
    valid_ids: list[str] = []
    for channel_id in payload.channel_ids:
        if db.get(NotificationChannel, channel_id) is None:
            continue
        valid_ids.append(channel_id)
        db.add(NotificationChannelGroupMember(group_id=group_id, channel_id=channel_id))
    db.commit()
    return NotificationChannelGroupResponse(id=group.id, name=group.name, channel_ids=valid_ids, created_at=group.created_at)


def delete_channel_group(db: Session, group_id: str) -> None:
    group = db.get(NotificationChannelGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="渠道分组不存在。")
    db.execute(delete(NotificationChannelGroupMember).where(NotificationChannelGroupMember.group_id == group_id))
    db.delete(group)
    db.commit()


def list_contacts(db: Session) -> list[NotificationContactResponse]:
    rows = db.scalars(select(NotificationContact).order_by(NotificationContact.name.asc())).all()
    return [
        NotificationContactResponse(
            id=row.id,
            name=row.name,
            type=row.type,  # type: ignore[arg-type]
            value=row.value,
            enabled=row.enabled,
            labels=row.labels_json or [],
            created_at=row.created_at,
            updated_at=row.updated_at,
        )
        for row in rows
    ]


def create_contact(db: Session, payload: NotificationContactPayload) -> NotificationContactResponse:
    contact = NotificationContact(
        id=payload.id or _new_id("contact"),
        name=payload.name.strip(),
        type=payload.type,
        value=payload.value,
        enabled=payload.enabled,
        labels_json=payload.labels,
    )
    db.add(contact)
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(contact)
    return NotificationContactResponse(
        id=contact.id,
        name=contact.name,
        type=contact.type,  # type: ignore[arg-type]
        value=contact.value,
        enabled=contact.enabled,
        labels=contact.labels_json or [],
        created_at=contact.created_at,
        updated_at=contact.updated_at,
    )


def update_contact(db: Session, contact_id: str, payload: NotificationContactPayload) -> NotificationContactResponse:
    contact = db.get(NotificationContact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="联系人不存在。")
    contact.name = payload.name.strip()
    contact.type = payload.type
    contact.value = payload.value
    contact.enabled = payload.enabled
    contact.labels_json = payload.labels
    db.commit()
    db.refresh(contact)
    return NotificationContactResponse(
        id=contact.id,
        name=contact.name,
        type=contact.type,  # type: ignore[arg-type]
        value=contact.value,
        enabled=contact.enabled,
        labels=contact.labels_json or [],
        created_at=contact.created_at,
        updated_at=contact.updated_at,
    )


def delete_contact(db: Session, contact_id: str) -> None:
    contact = db.get(NotificationContact, contact_id)
    if contact is None:
        raise HTTPException(status_code=404, detail="联系人不存在。")
    db.execute(delete(NotificationContactGroupMember).where(NotificationContactGroupMember.contact_id == contact_id))
    db.delete(contact)
    db.commit()


def list_contact_groups(db: Session) -> list[NotificationContactGroupResponse]:
    groups = db.scalars(select(NotificationContactGroup).order_by(NotificationContactGroup.name.asc())).all()
    members = db.scalars(select(NotificationContactGroupMember)).all()
    by_group: dict[str, list[str]] = {}
    for member in members:
        by_group.setdefault(member.group_id, []).append(member.contact_id)
    return [
        NotificationContactGroupResponse(
            id=group.id,
            name=group.name,
            contact_ids=by_group.get(group.id, []),
            created_at=group.created_at,
        )
        for group in groups
    ]


def create_contact_group(db: Session, payload: NotificationContactGroupPayload) -> NotificationContactGroupResponse:
    group_id = payload.id or _new_id("contact_group")
    group = NotificationContactGroup(id=group_id, name=payload.name.strip())
    db.add(group)
    valid_ids: list[str] = []
    for contact_id in payload.contact_ids:
        if db.get(NotificationContact, contact_id) is None:
            continue
        valid_ids.append(contact_id)
        db.add(NotificationContactGroupMember(group_id=group_id, contact_id=contact_id))
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(group)
    return NotificationContactGroupResponse(id=group.id, name=group.name, contact_ids=valid_ids, created_at=group.created_at)


def update_contact_group(db: Session, group_id: str, payload: NotificationContactGroupPayload) -> NotificationContactGroupResponse:
    group = db.get(NotificationContactGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="联系人分组不存在。")
    group.name = payload.name.strip()
    db.execute(delete(NotificationContactGroupMember).where(NotificationContactGroupMember.group_id == group_id))
    valid_ids: list[str] = []
    for contact_id in payload.contact_ids:
        if db.get(NotificationContact, contact_id) is None:
            continue
        valid_ids.append(contact_id)
        db.add(NotificationContactGroupMember(group_id=group_id, contact_id=contact_id))
    db.commit()
    return NotificationContactGroupResponse(id=group.id, name=group.name, contact_ids=valid_ids, created_at=group.created_at)


def delete_contact_group(db: Session, group_id: str) -> None:
    group = db.get(NotificationContactGroup, group_id)
    if group is None:
        raise HTTPException(status_code=404, detail="联系人分组不存在。")
    db.execute(delete(NotificationContactGroupMember).where(NotificationContactGroupMember.group_id == group_id))
    db.delete(group)
    db.commit()


def _template_response(row: NotificationTemplate) -> NotificationTemplateResponse:
    return NotificationTemplateResponse(
        id=row.id,
        name=row.name,
        channel_type=row.channel_type,
        subject_template=row.subject_template,
        body_template=row.body_template,
        provider_template_code=row.provider_template_code,
        param_map=row.param_map_json or {},
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def list_templates(db: Session) -> list[NotificationTemplateResponse]:
    rows = db.scalars(select(NotificationTemplate).order_by(NotificationTemplate.name.asc())).all()
    return [_template_response(row) for row in rows]


def create_template(db: Session, payload: NotificationTemplatePayload) -> NotificationTemplateResponse:
    row = NotificationTemplate(
        id=payload.id or _new_id("template"),
        name=payload.name.strip(),
        channel_type=payload.channel_type,
        subject_template=payload.subject_template,
        body_template=payload.body_template,
        provider_template_code=payload.provider_template_code,
        param_map_json=payload.param_map,
    )
    db.add(row)
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(row)
    return _template_response(row)


def update_template(db: Session, template_id: str, payload: NotificationTemplatePayload) -> NotificationTemplateResponse:
    row = db.get(NotificationTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="通知模板不存在。")
    row.name = payload.name.strip()
    row.channel_type = payload.channel_type
    row.subject_template = payload.subject_template
    row.body_template = payload.body_template
    row.provider_template_code = payload.provider_template_code
    row.param_map_json = payload.param_map
    db.commit()
    db.refresh(row)
    return _template_response(row)


def delete_template(db: Session, template_id: str) -> None:
    row = db.get(NotificationTemplate, template_id)
    if row is None:
        raise HTTPException(status_code=404, detail="通知模板不存在。")
    db.delete(row)
    db.commit()


def _rule_response(row: NotificationRule) -> NotificationRuleResponse:
    return NotificationRuleResponse(
        id=row.id,
        name=row.name,
        enabled=row.enabled,
        event_type=row.event_type,  # type: ignore[arg-type]
        severity=row.severity,  # type: ignore[arg-type]
        scope=row.scope_json or {},
        condition=row.condition_json or {},
        delivery=row.delivery_json or {},
        created_at=row.created_at,
        updated_at=row.updated_at,
    )


def _validate_rule_references(db: Session, payload: NotificationRulePayload) -> None:
    channel_ids = {row.id for row in db.scalars(select(NotificationChannel)).all()}
    group_ids = {row.id for row in db.scalars(select(NotificationChannelGroup)).all()}
    contact_group_ids = {row.id for row in db.scalars(select(NotificationContactGroup)).all()}
    invalid_channels = [item for item in payload.delivery.channel_ids if item not in channel_ids]
    if invalid_channels:
        raise HTTPException(status_code=422, detail=f"规则引用了不存在的渠道：{', '.join(invalid_channels)}")
    invalid_groups = [item for item in payload.delivery.channel_group_ids if item not in group_ids]
    if invalid_groups:
        raise HTTPException(status_code=422, detail=f"规则引用了不存在的渠道分组：{', '.join(invalid_groups)}")
    invalid_contacts = [item for item in payload.delivery.contact_group_ids if item not in contact_group_ids]
    if invalid_contacts:
        raise HTTPException(status_code=422, detail=f"规则引用了不存在的联系人分组：{', '.join(invalid_contacts)}")
    if payload.delivery.template_id and db.get(NotificationTemplate, payload.delivery.template_id) is None:
        raise HTTPException(status_code=422, detail="规则引用了不存在的通知模板。")


def list_rules(db: Session) -> list[NotificationRuleResponse]:
    rows = db.scalars(select(NotificationRule).order_by(NotificationRule.name.asc())).all()
    return [_rule_response(row) for row in rows]


def create_rule(db: Session, payload: NotificationRulePayload) -> NotificationRuleResponse:
    _validate_rule_references(db, payload)
    row = NotificationRule(
        id=payload.id or _new_id("rule"),
        name=payload.name,
        enabled=payload.enabled,
        event_type=payload.event_type,
        severity=payload.severity,
        scope_json=payload.scope.model_dump(mode="json"),
        condition_json=payload.condition.model_dump(mode="json"),
        delivery_json=payload.delivery.model_dump(mode="json"),
    )
    db.add(row)
    _ensure_v2_marker(db)
    db.commit()
    db.refresh(row)
    return _rule_response(row)


def update_rule(db: Session, rule_id: str, payload: NotificationRulePayload) -> NotificationRuleResponse:
    _validate_rule_references(db, payload)
    row = db.get(NotificationRule, rule_id)
    if row is None:
        raise HTTPException(status_code=404, detail="告警规则不存在。")
    row.name = payload.name
    row.enabled = payload.enabled
    row.event_type = payload.event_type
    row.severity = payload.severity
    row.scope_json = payload.scope.model_dump(mode="json")
    row.condition_json = payload.condition.model_dump(mode="json")
    row.delivery_json = payload.delivery.model_dump(mode="json")
    db.commit()
    db.refresh(row)
    return _rule_response(row)


def delete_rule(db: Session, rule_id: str) -> None:
    row = db.get(NotificationRule, rule_id)
    if row is None:
        raise HTTPException(status_code=404, detail="告警规则不存在。")
    db.execute(
        delete(NotificationRuleState).where(
            NotificationRuleState.rule_type.in_(["low_balance", "aggregate_balance", "connectivity_failure", "event"]),
            NotificationRuleState.rule_id == rule_id,
        )
    )
    db.delete(row)
    db.commit()


def _resolve_test_channels(db: Session, payload: NotificationTestPayload):
    runtime = get_runtime_app_settings(db)
    selected = list(payload.channel_ids)
    for group in runtime.notification_channel_groups:
        if group.id in payload.channel_group_ids:
            selected.extend(group.channel_ids)
    return _resolve_channels(
        runtime.notification_channels,
        selected_channel_ids=selected,
        default_channel_id=runtime.default_notification_channel_id,
    ), runtime


def send_test_notification(db: Session, payload: NotificationTestPayload) -> NotificationTestResponse:
    channels, _runtime = _resolve_test_channels(db, payload)
    if not channels:
        raise HTTPException(status_code=422, detail="没有可用的通知渠道。")
    template = None
    if payload.template_id:
        row = db.get(NotificationTemplate, payload.template_id)
        if row is not None:
            template = {
                "subject_template": row.subject_template,
                "body_template": row.body_template,
                "provider_template_code": row.provider_template_code,
                "param_map": row.param_map_json or {},
            }
    title = payload.title or "NiceApiManager 测试通知"
    body = payload.body or "这是一条测试消息。如果你收到了它，说明通知渠道配置可用。"
    recipients = resolve_contact_group_recipients(db, payload.contact_group_ids)
    fields = {key: str(value) for key, value in payload.context.items()}
    results = _deliver_message(
        channels,
        title=title,
        body=body,
        notify_type="info",
        fields=fields,
        recipients=recipients,
        template=template,
    )
    _create_notification_log(
        db,
        context=_NotificationDispatchContext(
            source_type="test",
            event_type="test",
            title=title,
            body=body,
            notify_type="info",
            fields=fields,
        ),
        results=results,
    )
    db.commit()
    success_count = sum(1 for item in results if item.success)
    return NotificationTestResponse(
        success=success_count > 0,
        total=len(results),
        success_count=success_count,
        failed_count=len(results) - success_count,
        items=results,
    )


def _instance_matches_scope(instance: Instance, scope: dict[str, Any]) -> bool:
    instance_ids = scope.get("instance_ids") or []
    tags = set(scope.get("tags") or [])
    if instance_ids and instance.id not in instance_ids:
        return False
    if tags and not tags.intersection(set(instance.tags_json or [])):
        return False
    if not scope.get("include_disabled") and not instance.enabled:
        return False
    return True


def dispatch_custom_event(db: Session, payload: CustomEventPayload) -> NotificationTestResponse:
    """Match normalized rules for an external event and deliver it."""
    instance = db.get(Instance, payload.instance_id) if payload.instance_id else None
    rules = db.scalars(
        select(NotificationRule).where(
            NotificationRule.enabled.is_(True),
            NotificationRule.event_type.in_([payload.event_type, "custom"]),
        )
    ).all()
    results: list[NotificationTestChannelResult] = []
    title = payload.title
    body = payload.body or ""
    fields = {key: str(value) for key, value in payload.fields.items()}
    fields.update({"title": title, "body": body, "severity": payload.severity})
    if instance is not None:
        fields.update({"instance": instance.name, "base_url": instance.base_url})
    now = utcnow()
    delivered_rules = 0
    for rule in rules:
        scope = rule.scope_json or {}
        if instance is not None and not _instance_matches_scope(instance, scope):
            continue
        if instance is None and (scope.get("instance_ids") or scope.get("tags")):
            continue
        condition = rule.condition_json or {}
        if _is_quiet_time(condition.get("quiet_hours"), now, payload.severity):
            continue
        delivery = rule.delivery_json or {}
        if payload.dedupe_key:
            state = db.scalar(
                select(NotificationRuleState).where(
                    NotificationRuleState.rule_type == "event",
                    NotificationRuleState.rule_id == rule.id,
                    NotificationRuleState.target_key == payload.dedupe_key,
                )
            )
            if state and state.status == "alerting" and state.last_triggered_at:
                if now - state.last_triggered_at < timedelta(minutes=1):
                    continue
        runtime = get_runtime_app_settings(db)
        selected_ids = list(delivery.get("channel_ids") or [])
        for group in runtime.notification_channel_groups:
            if group.id in (delivery.get("channel_group_ids") or []):
                selected_ids.extend(group.channel_ids)
        channels = _resolve_channels(
            runtime.notification_channels,
            selected_channel_ids=selected_ids,
            default_channel_id=runtime.default_notification_channel_id,
        )
        if not channels:
            continue
        template = None
        if delivery.get("template_id"):
            template_row = db.get(NotificationTemplate, delivery["template_id"])
            if template_row is not None:
                template = {
                    "subject_template": template_row.subject_template,
                    "body_template": template_row.body_template,
                    "provider_template_code": template_row.provider_template_code,
                    "param_map": template_row.param_map_json or {},
                }
        recipients = resolve_contact_group_recipients(db, delivery.get("contact_group_ids") or [])
        channel_results = _deliver_message(
            channels,
            title=title,
            body=body,
            notify_type="failure" if payload.severity == "critical" else "warning",
            fields=fields,
            recipients=recipients,
            template=template,
        )
        results.extend(channel_results)
        _create_notification_log(
            db,
            context=_NotificationDispatchContext(
                source_type="custom",
                event_type=payload.event_type,
                title=title,
                body=body,
                notify_type="failure" if payload.severity == "critical" else "warning",
                rule_type="event",
                rule_id=rule.id,
                rule_name=rule.name,
                instance_id=payload.instance_id,
                target_key=payload.dedupe_key,
                fields=fields,
            ),
            results=channel_results,
        )
        if payload.dedupe_key:
            state = db.scalar(
                select(NotificationRuleState).where(
                    NotificationRuleState.rule_type == "event",
                    NotificationRuleState.rule_id == rule.id,
                    NotificationRuleState.target_key == payload.dedupe_key,
                )
            )
            if state is None:
                state = NotificationRuleState(rule_type="event", rule_id=rule.id, target_key=payload.dedupe_key)
                db.add(state)
            state.status = "alerting"
            state.last_value = payload.severity
            state.last_triggered_at = now
            state.last_evaluated_at = now
        delivered_rules += 1
    db.commit()
    success_count = sum(1 for item in results if item.success)
    return NotificationTestResponse(
        success=success_count > 0,
        total=len(results),
        success_count=success_count,
        failed_count=len(results) - success_count,
        items=results,
    )


def get_overview(db: Session) -> NotificationOverviewResponse:
    runtime = get_runtime_app_settings(db)
    active_alerts = db.scalar(
        select(func.count(NotificationRuleState.id)).where(NotificationRuleState.status == "alerting")
    ) or 0
    enabled_rules = db.scalar(
        select(func.count(NotificationRule.id)).where(NotificationRule.enabled.is_(True))
    ) or 0
    enabled_channels = sum(1 for item in runtime.notification_channels if item.enabled)
    since = utcnow() - timedelta(hours=24)
    success_24h = db.scalar(
        select(func.count(NotificationLog.id)).where(
            NotificationLog.created_at >= since,
            NotificationLog.delivery_status.in_(["success", "partial"]),
        )
    ) or 0
    failed_24h = db.scalar(
        select(func.count(NotificationLog.id)).where(
            NotificationLog.created_at >= since,
            NotificationLog.delivery_status == "failed",
        )
    ) or 0
    last_scan = get_app_setting_record(db)
    last_scan_at = last_scan.notification_last_scan_at if last_scan else None
    next_scan_at = (
        last_scan_at + timedelta(minutes=runtime.notification_check_interval_minutes)
        if last_scan_at is not None
        else None
    )
    latest_logs = db.scalars(
        select(NotificationLog).order_by(NotificationLog.created_at.desc()).limit(100)
    ).all()
    health: dict[str, tuple[str | None, str | None, datetime | None]] = {}
    for log in latest_logs:
        for item in log.channels_json or []:
            channel_id = str(item.get("channel_id") or "")
            if not channel_id or channel_id in health:
                continue
            health[channel_id] = (
                "success" if item.get("success") else "failed",
                item.get("error_message"),
                log.created_at,
            )
    return NotificationOverviewResponse(
        active_alerts=int(active_alerts),
        enabled_rules=int(enabled_rules),
        enabled_channels=enabled_channels,
        success_24h=int(success_24h),
        failed_24h=int(failed_24h),
        last_scan_at=last_scan_at,
        next_scan_at=next_scan_at,
        channels=[
            NotificationChannelHealth(
                id=channel.id,
                name=channel.name,
                type=channel.type,
                enabled=channel.enabled,
                last_status=health.get(channel.id, (None, None, None))[0],
                last_error=health.get(channel.id, (None, None, None))[1],
                last_sent_at=health.get(channel.id, (None, None, None))[2],
            )
            for channel in runtime.notification_channels
        ],
    )


def list_deliveries(
    db: Session,
    *,
    instance_id: int | None = None,
    source_type: str | None = None,
    event_type: str | None = None,
    delivery_status: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> NotificationDeliveryListResponse:
    response = list_notification_logs(
        db,
        instance_id=instance_id,
        source_type=source_type,
        event_type=event_type,
        delivery_status=delivery_status,
        offset=offset,
        limit=limit,
    )
    items = response.items
    return NotificationDeliveryListResponse(
        total=response.total,
        items=[
            NotificationDeliveryResponse(
                id=item.id,
                instance_id=item.instance_id,
                instance_name=item.instance_name,
                rule_name=item.rule_name,
                event_type=item.event_type,
                source_type=item.source_type,
                title=item.title,
                body=item.body,
                delivery_status=item.delivery_status,
                channels=item.channels_json or [],
                error_message=item.error_message,
                created_at=item.created_at,
            )
            for item in items
        ],
    )
