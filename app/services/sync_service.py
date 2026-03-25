"""Connectivity test and manual sync orchestration."""

from __future__ import annotations

import logging

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.clients.newapi import NewAPIClient, NewAPIClientError, NewAPISessionData
from app.core.config import get_settings
from app.core.time import utcnow
from app.models import GroupRatio, Instance, InstanceSession, PricingModel, SyncRun, UserSnapshot
from app.schemas.instance import InstanceTestResponse
from app.schemas.sync_run import BulkSyncInstanceResult, BulkSyncResponse
from app.services.snapshot_metrics import quota_to_display_amount, uses_postpaid_billing


logger = logging.getLogger(__name__)
settings = get_settings()


def test_instance_connectivity(db: Session, instance: Instance) -> InstanceTestResponse:
    """Validate login and read-only endpoints for one configured instance."""
    client = NewAPIClient(
        base_url=instance.base_url,
        timeout=settings.request_timeout,
        verify=settings.sync_verify_ssl,
    )

    try:
        status_data = client.get_status()
        session_data = _ensure_session(db, instance, client)
        user_data = client.get_user_self(session_data.remote_user_id, session_data.cookie_value)
        group_data = client.get_user_groups(session_data.remote_user_id, session_data.cookie_value)
        pricing_payload = client.get_pricing(session_data.remote_user_id, session_data.cookie_value)
    except NewAPIClientError as exc:
        instance.last_health_status = "unhealthy"
        instance.last_health_error = str(exc)
        db.commit()
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=str(exc),
        ) from exc

    instance.last_health_status = "healthy"
    instance.last_health_error = None
    instance.quota_per_unit = _extract_quota_per_unit(status_data)
    db.commit()

    return InstanceTestResponse(
        success=True,
        instance_id=instance.id,
        remote_user_id=session_data.remote_user_id,
        remote_username=user_data.get("username") or instance.username,
        remote_group=user_data.get("group"),
        billing_mode=instance.billing_mode,
        quota=int(user_data.get("quota", 0)),
        used_quota=int(user_data.get("used_quota", 0)),
        display_quota=(
            None
            if uses_postpaid_billing(instance)
            else quota_to_display_amount(int(user_data.get("quota", 0)), instance.quota_per_unit)
        ),
        display_used_quota=quota_to_display_amount(int(user_data.get("used_quota", 0)), instance.quota_per_unit),
        quota_per_unit=instance.quota_per_unit,
        request_count=int(user_data.get("request_count", 0)),
        group_count=len(group_data),
        pricing_model_count=len(pricing_payload.get("data") or []),
    )


def sync_single_instance(db: Session, instance: Instance, trigger_type: str = "manual") -> SyncRun:
    """Run a full read-only sync for one instance and persist the latest snapshot."""
    instance_id = instance.id

    sync_run = SyncRun(
        instance_id=instance_id,
        trigger_type=trigger_type,
        status="running",
        started_at=utcnow(),
    )
    db.add(sync_run)
    db.commit()
    db.refresh(sync_run)

    client = NewAPIClient(
        base_url=instance.base_url,
        timeout=settings.request_timeout,
        verify=settings.sync_verify_ssl,
    )

    try:
        status_data = client.get_status()
        session_data = _ensure_session(db, instance, client)
        user_data = client.get_user_self(session_data.remote_user_id, session_data.cookie_value)
        group_data = client.get_user_groups(session_data.remote_user_id, session_data.cookie_value)
        pricing_payload = client.get_pricing(session_data.remote_user_id, session_data.cookie_value)

        snapshot_at = utcnow()
        _persist_user_snapshot(db, instance_id, user_data, snapshot_at)
        _replace_group_ratios(db, instance_id, group_data, snapshot_at)
        _replace_pricing_models(db, instance_id, pricing_payload, snapshot_at)

        finished_at = utcnow()
        duration_ms = int((finished_at - sync_run.started_at).total_seconds() * 1000)
        summary = {
            "group_count": len(group_data),
            "pricing_model_count": len(pricing_payload.get("data") or []),
            "quota": int(user_data.get("quota", 0)),
            "used_quota": int(user_data.get("used_quota", 0)),
            "request_count": int(user_data.get("request_count", 0)),
        }

        sync_run = db.get(SyncRun, sync_run.id)
        instance = db.get(Instance, instance_id)
        instance.quota_per_unit = _extract_quota_per_unit(status_data)
        sync_run.status = "success"
        sync_run.finished_at = finished_at
        sync_run.duration_ms = duration_ms
        sync_run.error_message = None
        sync_run.summary_json = summary
        instance.last_sync_at = finished_at
        instance.last_health_status = "healthy"
        instance.last_health_error = None
        db.commit()
        db.refresh(sync_run)
        return sync_run

    except Exception as exc:
        logger.exception("Sync failed for instance %s", instance_id)
        db.rollback()

        finished_at = utcnow()
        sync_run = db.get(SyncRun, sync_run.id)
        instance = db.get(Instance, instance_id)
        sync_run.status = "failed"
        sync_run.finished_at = finished_at
        sync_run.duration_ms = int((finished_at - sync_run.started_at).total_seconds() * 1000)
        sync_run.error_message = str(exc)
        sync_run.summary_json = None
        instance.last_health_status = "unhealthy"
        instance.last_health_error = str(exc)
        db.commit()

        if isinstance(exc, NewAPIClientError):
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail=str(exc),
            ) from exc

        raise


def sync_all_instances(db: Session) -> BulkSyncResponse:
    """Run manual sync sequentially for every enabled instance."""
    instances = db.scalars(
        select(Instance).where(Instance.enabled.is_(True)).order_by(Instance.id.asc())
    ).all()

    results: list[BulkSyncInstanceResult] = []
    success_count = 0
    failed_count = 0

    for instance in instances:
        try:
            sync_run = sync_single_instance(db, instance, trigger_type="manual")
            results.append(
                BulkSyncInstanceResult(
                    instance_id=instance.id,
                    instance_name=instance.name,
                    status="success",
                    sync_run_id=sync_run.id,
                )
            )
            success_count += 1
        except HTTPException as exc:
            results.append(
                BulkSyncInstanceResult(
                    instance_id=instance.id,
                    instance_name=instance.name,
                    status="failed",
                    error_message=str(exc.detail),
                )
            )
            failed_count += 1

    return BulkSyncResponse(
        total=len(results),
        success_count=success_count,
        failed_count=failed_count,
        items=results,
    )


def _ensure_session(
    db: Session,
    instance: Instance,
    client: NewAPIClient,
) -> NewAPISessionData:
    """Reuse a cached session if still valid, otherwise log in again."""
    cached_session = db.scalar(
        select(InstanceSession).where(InstanceSession.instance_id == instance.id)
    )

    if cached_session and _session_is_still_usable(cached_session):
        try:
            client.get_user_self(cached_session.remote_user_id, cached_session.cookie_value)
            return NewAPISessionData(
                remote_user_id=cached_session.remote_user_id,
                cookie_value=cached_session.cookie_value,
                expires_at=cached_session.expires_at,
            )
        except NewAPIClientError:
            logger.info("Cached session for instance %s expired remotely, relogging in.", instance.id)

    session_data = client.login(instance.username, instance.password)

    if cached_session is None:
        cached_session = InstanceSession(instance_id=instance.id)
        db.add(cached_session)

    cached_session.remote_user_id = session_data.remote_user_id
    cached_session.cookie_value = session_data.cookie_value
    cached_session.expires_at = session_data.expires_at

    try:
        db.commit()
    except IntegrityError:
        # Another request may have created the row first. Reload and reuse the stored session.
        db.rollback()
        concurrent_session = db.scalar(
            select(InstanceSession).where(InstanceSession.instance_id == instance.id)
        )
        if concurrent_session is None:
            raise

        return NewAPISessionData(
            remote_user_id=concurrent_session.remote_user_id,
            cookie_value=concurrent_session.cookie_value,
            expires_at=concurrent_session.expires_at,
        )

    return session_data


def _session_is_still_usable(session: InstanceSession) -> bool:
    """Guard against obviously expired cached sessions before reusing them."""
    if session.expires_at is None:
        return True
    return session.expires_at > utcnow()


def _persist_user_snapshot(
    db: Session,
    instance_id: int,
    user_data: dict[str, object],
    snapshot_at,
) -> None:
    """Append the latest quota counters to the historical snapshots table."""
    db.add(
        UserSnapshot(
            instance_id=instance_id,
            quota=int(user_data.get("quota", 0)),
            used_quota=int(user_data.get("used_quota", 0)),
            request_count=int(user_data.get("request_count", 0)),
            group_name=(user_data.get("group") or None),
            snapshot_at=snapshot_at,
        )
    )


def _replace_group_ratios(
    db: Session,
    instance_id: int,
    group_data: dict[str, object],
    snapshot_at,
) -> None:
    """Replace the current stored group ratios for one instance."""
    db.execute(delete(GroupRatio).where(GroupRatio.instance_id == instance_id))

    for group_name, payload in group_data.items():
        if not isinstance(payload, dict):
            continue
        row = payload
        db.add(
            GroupRatio(
                instance_id=instance_id,
                group_name=group_name,
                group_desc=row.get("desc"),
                ratio=float(row.get("ratio", 0)),
                snapshot_at=snapshot_at,
            )
        )


def _replace_pricing_models(
    db: Session,
    instance_id: int,
    pricing_payload: dict[str, object],
    snapshot_at,
) -> None:
    """Replace the current stored pricing models for one instance."""
    db.execute(delete(PricingModel).where(PricingModel.instance_id == instance_id))

    vendors = {
        vendor.get("id"): vendor.get("name")
        for vendor in (pricing_payload.get("vendors") or [])
        if isinstance(vendor, dict) and vendor.get("id") is not None
    }

    for row in pricing_payload.get("data") or []:
        if not isinstance(row, dict):
            continue
        db.add(
            PricingModel(
                instance_id=instance_id,
                model_name=str(row.get("model_name")),
                vendor_id=row.get("vendor_id"),
                vendor_name=vendors.get(row.get("vendor_id")),
                quota_type=int(row.get("quota_type", 0)),
                model_ratio=float(row.get("model_ratio", 0)),
                model_price=float(row.get("model_price", 0)),
                completion_ratio=float(row.get("completion_ratio", 0)),
                enable_groups_json=list(row.get("enable_groups") or []),
                supported_endpoint_types_json=list(row.get("supported_endpoint_types") or []),
                snapshot_at=snapshot_at,
            )
        )


def _extract_quota_per_unit(status_data: dict[str, object]) -> float | None:
    """Read `quota_per_unit` from the remote status payload."""
    value = status_data.get("quota_per_unit")
    if value in (None, ""):
        return None

    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return None

    return parsed if parsed > 0 else None
