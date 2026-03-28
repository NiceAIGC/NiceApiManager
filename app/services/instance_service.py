"""Instance CRUD helpers."""

from __future__ import annotations

import httpx

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.clients.newapi import NewAPIClient, NewAPIClientError, detect_program_type
from app.models import Instance
from app.models.user_snapshot import UserSnapshot
from app.schemas.instance import (
    BatchInstanceDeleteResponse,
    BatchInstanceResponse,
    BatchInstanceUpdateItem,
    InstanceCreate,
    InstanceListResponse,
    ProxyConnectivityTestRequest,
    ProxyConnectivityTestResponse,
    InstanceResponse,
    InstanceUpdate,
)
from app.services.app_setting_service import get_runtime_app_settings
from app.services.instance_filters import apply_instance_filters, normalize_base_url
from app.services.proxy_utils import normalize_socks5_proxy_url, resolve_socks5_proxy_url
from app.services.snapshot_metrics import current_day_start_utc, quota_to_display_amount, today_request_count, uses_postpaid_billing


def _normalize_tags(tags: list[str] | None) -> list[str]:
    """Return normalized instance tags without blanks or duplicates."""
    normalized: list[str] = []
    seen: set[str] = set()

    for item in tags or []:
        value = item.strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)

    return normalized


def _normalize_optional_text(value: str | None) -> str:
    """Trim optional text input while preserving empty-string semantics."""
    return (value or "").strip()


def _validate_instance_auth(username: str, password: str, remote_user_id: int | None, access_token: str | None) -> None:
    """Ensure each instance keeps at least one complete authentication method."""
    has_password_auth = bool(username and password)
    has_token_auth = remote_user_id is not None and bool(access_token)
    if has_password_auth or has_token_auth:
        return

    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail="请填写用户名和密码，或填写远端用户 ID 和访问密钥。",
    )


def _clear_cached_session(db: Session, instance: Instance) -> None:
    """Drop cached login state after authentication-related fields change."""
    if instance.session is not None:
        db.delete(instance.session)


def create_instance(db: Session, payload: InstanceCreate) -> Instance:
    """Create and persist a new instance record."""
    runtime_settings = get_runtime_app_settings(db)
    username = payload.username.strip()
    password = _normalize_optional_text(payload.password)
    access_token = _normalize_optional_text(payload.access_token) or None
    _validate_instance_auth(username, password, payload.remote_user_id, access_token)

    instance = Instance(
        name=payload.name.strip(),
        base_url=normalize_base_url(payload.base_url),
        program_type=payload.program_type,
        username=username,
        password=password,
        remote_user_id=payload.remote_user_id,
        access_token=access_token,
        proxy_mode=payload.proxy_mode,
        socks5_proxy_url=normalize_socks5_proxy_url(payload.socks5_proxy_url),
        enabled=payload.enabled,
        billing_mode=payload.billing_mode,
        priority=payload.priority,
        sync_interval_minutes=payload.sync_interval_minutes or runtime_settings.default_sync_interval_minutes,
        tags_json=_normalize_tags(payload.tags),
    )
    db.add(instance)
    db.commit()
    db.refresh(instance)
    return instance


def create_instances_batch(db: Session, payloads: list[InstanceCreate]) -> BatchInstanceResponse:
    """Create multiple instances in one transaction."""
    runtime_settings = get_runtime_app_settings(db)
    instances = []
    for payload in payloads:
        username = payload.username.strip()
        password = _normalize_optional_text(payload.password)
        access_token = _normalize_optional_text(payload.access_token) or None
        _validate_instance_auth(username, password, payload.remote_user_id, access_token)
        instances.append(
            Instance(
                name=payload.name.strip(),
                base_url=normalize_base_url(payload.base_url),
                program_type=payload.program_type,
                username=username,
                password=password,
                remote_user_id=payload.remote_user_id,
                access_token=access_token,
                proxy_mode=payload.proxy_mode,
                socks5_proxy_url=normalize_socks5_proxy_url(payload.socks5_proxy_url),
                enabled=payload.enabled,
                billing_mode=payload.billing_mode,
                priority=payload.priority,
                sync_interval_minutes=payload.sync_interval_minutes or runtime_settings.default_sync_interval_minutes,
                tags_json=_normalize_tags(payload.tags),
            )
        )

    db.add_all(instances)
    db.commit()

    for instance in instances:
        db.refresh(instance)

    scheduler_timezone = get_runtime_app_settings(db).scheduler_timezone
    day_start_utc = current_day_start_utc(scheduler_timezone)
    items = [
        _instance_to_response(db, instance, day_start_utc=day_start_utc, scheduler_timezone=scheduler_timezone)
        for instance in instances
    ]
    return BatchInstanceResponse(count=len(items), items=items)


def update_instance(db: Session, instance: Instance, payload: InstanceUpdate) -> Instance:
    """Update a configured instance and persist the changes."""
    new_username = payload.username.strip()
    new_remote_user_id = payload.remote_user_id
    new_program_type = payload.program_type
    new_base_url = normalize_base_url(payload.base_url)
    new_proxy_mode = payload.proxy_mode
    new_socks5_proxy_url = normalize_socks5_proxy_url(payload.socks5_proxy_url)

    if new_username:
        new_password = instance.password
        if payload.password not in (None, ""):
            new_password = payload.password
    else:
        new_password = ""

    if new_remote_user_id is not None:
        new_access_token = instance.access_token
        if payload.access_token not in (None, ""):
            new_access_token = _normalize_optional_text(payload.access_token) or None
    else:
        new_access_token = None

    _validate_instance_auth(new_username, new_password, new_remote_user_id, new_access_token)
    auth_changed = any(
        [
            instance.base_url != new_base_url,
            instance.program_type != new_program_type,
            instance.username != new_username,
            instance.password != new_password,
            instance.remote_user_id != new_remote_user_id,
            instance.access_token != new_access_token,
            instance.proxy_mode != new_proxy_mode,
            instance.socks5_proxy_url != new_socks5_proxy_url,
        ]
    )

    instance.name = payload.name.strip()
    instance.base_url = new_base_url
    instance.program_type = new_program_type
    instance.username = new_username
    instance.password = new_password
    instance.remote_user_id = new_remote_user_id
    instance.access_token = new_access_token
    instance.proxy_mode = new_proxy_mode
    instance.socks5_proxy_url = new_socks5_proxy_url
    instance.enabled = payload.enabled
    instance.billing_mode = payload.billing_mode
    instance.priority = payload.priority
    instance.sync_interval_minutes = payload.sync_interval_minutes
    instance.tags_json = _normalize_tags(payload.tags)
    if auth_changed:
        _clear_cached_session(db, instance)

    db.commit()
    db.refresh(instance)
    return instance


def update_instances_batch(db: Session, payloads: list[BatchInstanceUpdateItem]) -> BatchInstanceResponse:
    """Update multiple instances in one transaction."""
    ids = [item.id for item in payloads]
    if not ids:
        return BatchInstanceResponse(count=0, items=[])

    instances = db.scalars(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id.in_(ids))
        .order_by(Instance.id.asc())
    ).all()
    instances_by_id = {instance.id: instance for instance in instances}

    missing_ids = [instance_id for instance_id in ids if instance_id not in instances_by_id]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instances not found: {', '.join(str(item) for item in missing_ids)}.",
        )

    for payload in payloads:
        instance = instances_by_id[payload.id]
        new_username = payload.username.strip()
        new_remote_user_id = payload.remote_user_id
        new_program_type = payload.program_type
        new_base_url = normalize_base_url(payload.base_url)
        new_proxy_mode = payload.proxy_mode
        new_socks5_proxy_url = normalize_socks5_proxy_url(payload.socks5_proxy_url)

        if new_username:
            new_password = instance.password
            if payload.password not in (None, ""):
                new_password = payload.password
        else:
            new_password = ""

        if new_remote_user_id is not None:
            new_access_token = instance.access_token
            if payload.access_token not in (None, ""):
                new_access_token = _normalize_optional_text(payload.access_token) or None
        else:
            new_access_token = None

        _validate_instance_auth(new_username, new_password, new_remote_user_id, new_access_token)
        auth_changed = any(
            [
                instance.base_url != new_base_url,
                instance.program_type != new_program_type,
                instance.username != new_username,
                instance.password != new_password,
                instance.remote_user_id != new_remote_user_id,
                instance.access_token != new_access_token,
                instance.proxy_mode != new_proxy_mode,
                instance.socks5_proxy_url != new_socks5_proxy_url,
            ]
        )

        instance.name = payload.name.strip()
        instance.base_url = new_base_url
        instance.program_type = new_program_type
        instance.username = new_username
        instance.password = new_password
        instance.remote_user_id = new_remote_user_id
        instance.access_token = new_access_token
        instance.proxy_mode = new_proxy_mode
        instance.socks5_proxy_url = new_socks5_proxy_url
        instance.enabled = payload.enabled
        instance.billing_mode = payload.billing_mode
        instance.priority = payload.priority
        instance.sync_interval_minutes = payload.sync_interval_minutes
        instance.tags_json = _normalize_tags(payload.tags)
        if auth_changed:
            _clear_cached_session(db, instance)

    db.commit()

    refreshed_instances = db.scalars(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id.in_(ids))
        .order_by(Instance.id.asc())
    ).all()
    scheduler_timezone = get_runtime_app_settings(db).scheduler_timezone
    day_start_utc = current_day_start_utc(scheduler_timezone)
    items = [
        _instance_to_response(db, instance, day_start_utc=day_start_utc, scheduler_timezone=scheduler_timezone)
        for instance in refreshed_instances
    ]
    return BatchInstanceResponse(count=len(items), items=items)


def delete_instance(db: Session, instance: Instance) -> None:
    """Delete one instance and all related rows through cascading FKs."""
    db.delete(instance)
    db.commit()


def delete_instances_batch(db: Session, ids: list[int]) -> BatchInstanceDeleteResponse:
    """Delete multiple instances in one transaction."""
    unique_ids = list(dict.fromkeys(ids))
    if not unique_ids:
        return BatchInstanceDeleteResponse(count=0, deleted_ids=[])

    instances = db.scalars(select(Instance).where(Instance.id.in_(unique_ids))).all()
    found_ids = {instance.id for instance in instances}
    missing_ids = [instance_id for instance_id in unique_ids if instance_id not in found_ids]
    if missing_ids:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Instances not found: {', '.join(str(item) for item in missing_ids)}.",
        )

    for instance in instances:
        db.delete(instance)

    db.commit()
    return BatchInstanceDeleteResponse(count=len(unique_ids), deleted_ids=unique_ids)


def test_proxy_connectivity(
    db: Session,
    payload: ProxyConnectivityTestRequest,
) -> ProxyConnectivityTestResponse:
    """Test one proxy setting by requesting the target instance `/api/status` endpoint."""
    runtime_settings = get_runtime_app_settings(db)
    normalized_base_url = normalize_base_url(payload.base_url)
    normalized_custom_proxy_url = normalize_socks5_proxy_url(payload.socks5_proxy_url)
    resolved_proxy_url = resolve_socks5_proxy_url(
        proxy_mode=payload.proxy_mode,
        custom_proxy_url=normalized_custom_proxy_url,
        shared_proxy_url=runtime_settings.shared_socks5_proxy_url,
    )

    if payload.proxy_mode == "global" and not resolved_proxy_url:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="当前未配置公用 SOCKS5 代理，请先到系统设置里保存后再测试。",
        )

    client = NewAPIClient(
        base_url=normalized_base_url,
        timeout=runtime_settings.request_timeout,
        verify=runtime_settings.sync_verify_ssl,
        proxy=resolved_proxy_url,
    )

    try:
        status_data = client.get_status()
    except NewAPIClientError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"代理测试失败：{exc}",
        ) from exc
    except httpx.HTTPError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"代理测试失败：{exc}",
        ) from exc

    return ProxyConnectivityTestResponse(
        success=True,
        base_url=normalized_base_url,
        proxy_mode=payload.proxy_mode,
        resolved_proxy_url=resolved_proxy_url,
        detected_program_type=detect_program_type(status_data),
        quota_per_unit=_coerce_positive_float(status_data.get("quota_per_unit")),
    )


def get_instance_or_404(db: Session, instance_id: int) -> Instance:
    """Fetch one instance or raise an HTTP 404 for API callers."""
    instance = db.scalar(
        select(Instance)
        .options(selectinload(Instance.session))
        .where(Instance.id == instance_id)
    )
    if not instance:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Instance not found.")
    return instance


def list_instances(
    db: Session,
    *,
    search: str | None = None,
    tags: str | list[str] | None = None,
    billing_mode: str | None = None,
    enabled: bool | None = None,
    health_status: str | None = None,
) -> InstanceListResponse:
    """Return all configured instances with session metadata when available."""
    stmt = (
        select(Instance)
        .options(selectinload(Instance.session))
        .order_by(Instance.id.asc())
    )
    instances = db.scalars(
        apply_instance_filters(
            stmt,
            search=search,
            tags=tags,
            billing_mode=billing_mode,
            enabled=enabled,
            health_status=health_status,
        )
    ).all()
    scheduler_timezone = get_runtime_app_settings(db).scheduler_timezone
    day_start_utc = current_day_start_utc(scheduler_timezone)

    items = [
        _instance_to_response(db, instance, day_start_utc=day_start_utc, scheduler_timezone=scheduler_timezone)
        for instance in instances
    ]

    return InstanceListResponse(total=len(items), items=items)


def _instance_to_response(
    db: Session,
    instance: Instance,
    *,
    day_start_utc,
    scheduler_timezone: str,
) -> InstanceResponse:
    """Convert one ORM instance into the API response shape."""
    latest_snapshot = db.scalars(
        select(UserSnapshot)
        .where(UserSnapshot.instance_id == instance.id)
        .order_by(UserSnapshot.snapshot_at.desc())
        .limit(1)
    ).first()

    return InstanceResponse.model_validate(instance).model_copy(
        update={
            "tags": instance.tags_json or [],
            "program_type": instance.program_type,
            "billing_mode": instance.billing_mode,
            "quota_per_unit": instance.quota_per_unit,
            "latest_group_name": latest_snapshot.group_name if latest_snapshot else None,
            "latest_quota": (
                None
                if uses_postpaid_billing(instance)
                else (latest_snapshot.quota if latest_snapshot else None)
            ),
            "latest_used_quota": latest_snapshot.used_quota if latest_snapshot else None,
            "latest_display_quota": (
                None
                if uses_postpaid_billing(instance)
                else quota_to_display_amount(latest_snapshot.quota if latest_snapshot else None, instance.quota_per_unit)
            ),
            "latest_display_used_quota": quota_to_display_amount(
                latest_snapshot.used_quota if latest_snapshot else None,
                instance.quota_per_unit,
            ),
            "latest_request_count": latest_snapshot.request_count if latest_snapshot else None,
            "today_request_count": today_request_count(
                db,
                instance.id,
                latest_snapshot,
                day_start_utc,
                scheduler_timezone,
            ),
            "remote_user_id": instance.session.remote_user_id if instance.session else instance.remote_user_id,
            "has_access_token": bool(instance.access_token),
            "proxy_mode": instance.proxy_mode,
            "socks5_proxy_url": instance.socks5_proxy_url,
            "priority": instance.priority,
            "sync_interval_minutes": instance.sync_interval_minutes,
            "session_expires_at": instance.session.expires_at if instance.session else None,
        }
    )


def _coerce_positive_float(value: object) -> float | None:
    """Return one positive float or `None` when the input is blank or invalid."""
    if value in (None, ""):
        return None

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    return parsed if parsed > 0 else None
