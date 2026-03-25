"""Connectivity test and manual sync orchestration."""

from __future__ import annotations

import logging
from datetime import date, datetime, time, timedelta, timezone

from fastapi import HTTPException, status
from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.clients.newapi import NewAPIClient, NewAPIClientError, NewAPISessionData, detect_program_type
from app.core.config import get_settings
from app.core.time import utcnow
from app.models import DailyUsageStat, GroupRatio, Instance, InstanceSession, PricingModel, SyncRun, UserSnapshot
from app.schemas.instance import InstanceTestResponse
from app.schemas.sync_run import BulkSyncInstanceResult, BulkSyncResponse
from app.services.snapshot_metrics import quota_to_display_amount, resolve_timezone, uses_postpaid_billing


logger = logging.getLogger(__name__)
settings = get_settings()
HISTORY_LOOKBACK_DAYS = 30


def test_instance_connectivity(db: Session, instance: Instance) -> InstanceTestResponse:
    """Validate login and read-only endpoints for one configured instance."""
    try:
        client, status_data = _prepare_instance_client(instance)
        session_data = _ensure_session(db, instance, client)
        user_data = client.get_user_self(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )
        group_data = client.get_user_groups(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )
        pricing_payload = client.get_pricing(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )
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
        program_type=instance.program_type,
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

    try:
        client, status_data = _prepare_instance_client(instance)
        session_data = _ensure_session(db, instance, client)
        user_data = client.get_user_self(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )
        group_data = client.get_user_groups(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )
        pricing_payload = client.get_pricing(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
        )

        snapshot_at = utcnow()
        instance.quota_per_unit = _extract_quota_per_unit(status_data)
        _persist_user_snapshot(db, instance_id, user_data, snapshot_at)
        _replace_group_ratios(db, instance_id, group_data, snapshot_at)
        _replace_pricing_models(db, instance_id, pricing_payload, snapshot_at)
        history_source, history_warning = _sync_recent_daily_usage(
            db,
            instance=instance,
            client=client,
            session_data=session_data,
            synced_at=snapshot_at,
        )

        finished_at = utcnow()
        duration_ms = int((finished_at - sync_run.started_at).total_seconds() * 1000)
        summary = {
            "group_count": len(group_data),
            "pricing_model_count": len(pricing_payload.get("data") or []),
            "quota": int(user_data.get("quota", 0)),
            "used_quota": int(user_data.get("used_quota", 0)),
            "request_count": int(user_data.get("request_count", 0)),
            "history_days": HISTORY_LOOKBACK_DAYS,
            "history_source": history_source,
        }
        if history_warning:
            summary["history_warning"] = history_warning

        sync_run = db.get(SyncRun, sync_run.id)
        instance = db.get(Instance, instance_id)
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
    token_session = _try_access_token_session(instance, client)
    if token_session is not None:
        return token_session

    cached_session = db.scalar(
        select(InstanceSession).where(InstanceSession.instance_id == instance.id)
    )

    if cached_session and _session_is_still_usable(cached_session):
        try:
            client.get_user_self(
                cached_session.remote_user_id,
                cached_session.cookie_value,
                cached_session.access_token,
            )
            return NewAPISessionData(
                remote_user_id=cached_session.remote_user_id,
                cookie_value=cached_session.cookie_value,
                access_token=cached_session.access_token,
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
    cached_session.access_token = session_data.access_token
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
            access_token=concurrent_session.access_token,
            expires_at=concurrent_session.expires_at,
        )

    return session_data


def _try_access_token_session(
    instance: Instance,
    client: NewAPIClient,
) -> NewAPISessionData | None:
    """Prefer access-token auth and only fall back when credentials are available."""
    if instance.remote_user_id is None or not instance.access_token:
        return None

    try:
        client.get_user_self(
            instance.remote_user_id,
            "",
            instance.access_token,
        )
    except NewAPIClientError as exc:
        if instance.username and instance.password:
            logger.info(
                "Access token auth failed for instance %s, falling back to username/password: %s",
                instance.id,
                exc,
            )
            return None
        raise

    return NewAPISessionData(
        remote_user_id=instance.remote_user_id,
        cookie_value="",
        access_token=instance.access_token,
        expires_at=None,
    )


def _prepare_instance_client(instance: Instance) -> tuple[NewAPIClient, dict[str, object]]:
    """Build a client and auto-correct the configured program type from `/api/status`."""
    client = NewAPIClient(
        base_url=instance.base_url,
        program_type=instance.program_type,
        timeout=settings.request_timeout,
        verify=settings.sync_verify_ssl,
    )
    status_data = client.get_status()
    detected_program_type = detect_program_type(status_data, instance.program_type)
    if detected_program_type != instance.program_type:
        instance.program_type = detected_program_type
        client = client.with_program_type(detected_program_type)

    return client, status_data


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
                ratio=_coerce_float(row.get("ratio", 0)),
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
                quota_type=_coerce_int(row.get("quota_type", 0)),
                model_ratio=_coerce_float(row.get("model_ratio", 0)),
                model_price=_coerce_float(row.get("model_price", 0)),
                completion_ratio=_coerce_float(row.get("completion_ratio", 0)),
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


def _sync_recent_daily_usage(
    db: Session,
    *,
    instance: Instance,
    client: NewAPIClient,
    session_data: NewAPISessionData,
    synced_at: datetime,
) -> tuple[str, str | None]:
    """Refresh recent daily usage totals from remote consumption logs."""
    tzinfo = resolve_timezone(settings.scheduler_timezone)
    today_local = synced_at.replace(tzinfo=timezone.utc).astimezone(tzinfo).date()
    start_date = today_local - timedelta(days=HISTORY_LOOKBACK_DAYS - 1)
    start_at_utc = datetime.combine(start_date, time.min, tzinfo=tzinfo).astimezone(timezone.utc)
    end_at_utc = datetime.combine(today_local + timedelta(days=1), time.min, tzinfo=tzinfo).astimezone(timezone.utc)
    aggregated = {
        current_date: {"request_count": 0, "used_quota": 0}
        for current_date in _iter_usage_dates(start_date, today_local)
    }

    history_source = "data_api"
    history_warning: str | None = None

    try:
        quota_rows = client.get_user_quota_data(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
            start_timestamp=int(start_at_utc.timestamp()),
            end_timestamp=int(end_at_utc.timestamp()),
        )
        _accumulate_daily_usage_from_quota_rows(
            aggregated,
            quota_rows=quota_rows,
            tzinfo=tzinfo,
        )
    except NewAPIClientError as exc:
        logger.warning(
            "Daily usage sync via /api/data/self failed for instance %s: %s",
            instance.id,
            exc,
        )
        history_source = "data_api_failed"
        history_warning = f"/api/data/self 同步失败，已跳过历史用量刷新：{exc}"

    existing_rows = db.scalars(
        select(DailyUsageStat).where(
            DailyUsageStat.instance_id == instance.id,
            DailyUsageStat.usage_date >= start_date,
            DailyUsageStat.usage_date <= today_local,
        )
    ).all()
    existing_by_date = {row.usage_date: row for row in existing_rows}

    for usage_date, item in aggregated.items():
        used_quota = int(item["used_quota"])
        request_count = int(item["request_count"])
        used_display_amount = quota_to_display_amount(used_quota, instance.quota_per_unit) or 0.0
        existing_row = existing_by_date.get(usage_date)
        if existing_row is None:
            db.add(
                DailyUsageStat(
                    instance_id=instance.id,
                    usage_date=usage_date,
                    request_count=request_count,
                    used_quota=used_quota,
                    used_display_amount=used_display_amount,
                    synced_at=synced_at,
                )
            )
            continue

        existing_row.request_count = request_count
        existing_row.used_quota = used_quota
        existing_row.used_display_amount = used_display_amount
        existing_row.synced_at = synced_at

    return history_source, history_warning


def _accumulate_daily_usage_from_quota_rows(
    aggregated: dict[date, dict[str, int]],
    *,
    quota_rows: list[dict[str, object]],
    tzinfo,
) -> None:
    """Fold `/api/data/self` rows into per-day request and quota totals."""
    for row in quota_rows:
        created_at = row.get("created_at")
        if created_at in (None, ""):
            continue

        try:
            timestamp = int(created_at)
        except (TypeError, ValueError):
            continue

        usage_date = datetime.fromtimestamp(timestamp, tz=timezone.utc).astimezone(tzinfo).date()
        if usage_date not in aggregated:
            continue

        aggregated[usage_date]["request_count"] += max(_coerce_int(row.get("count", 0)), 0)
        aggregated[usage_date]["used_quota"] += max(_coerce_int(row.get("quota", 0)), 0)


def _iter_usage_dates(start_date: date, end_date: date):
    """Yield dates inclusively for the requested usage window."""
    current = start_date
    while current <= end_date:
        yield current
        current += timedelta(days=1)


def _coerce_float(value: object, default: float = 0.0) -> float:
    """Convert upstream numeric-like values into floats without crashing the sync."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _coerce_int(value: object, default: int = 0) -> int:
    """Convert upstream numeric-like values into ints without crashing the sync."""
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
