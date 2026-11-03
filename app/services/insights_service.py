"""Rich per-instance insights for the instance detail dialog."""

from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import Announcement, GroupLabel, GroupLabelAssignment, GroupRatio, Instance, RateChangeEvent
from app.services.app_setting_service import RuntimeAppSettings, get_runtime_app_settings
from app.services.snapshot_metrics import quota_to_display_amount

logger = logging.getLogger(__name__)

MAX_LOG_PAGES = 8
LOG_PAGE_SIZE = 100


def build_instance_insights(db: Session, instance: Instance, *, days: int = 7) -> dict[str, object]:
    """DB-only insights (fast): groups, rate changes and announcements."""
    label_map = _group_label_map(db)
    groups = db.scalars(
        select(GroupRatio).where(GroupRatio.instance_id == instance.id).order_by(GroupRatio.ratio.desc())
    ).all()
    rate_changes = db.scalars(
        select(RateChangeEvent)
        .where(RateChangeEvent.instance_id == instance.id)
        .order_by(RateChangeEvent.detected_at.desc())
        .limit(20)
    ).all()
    announcements = db.scalars(
        select(Announcement)
        .where(Announcement.instance_id == instance.id)
        .order_by(Announcement.synced_at.desc())
        .limit(20)
    ).all()

    return {
        "instance_id": instance.id,
        "days": days,
        "groups": [
            {
                "group_name": row.group_name,
                "group_desc": row.group_desc,
                "ratio": row.ratio,
                "platform": row.platform,
                "user_ratio": row.user_ratio,
                "peak_ratio": row.peak_ratio,
                "peak_start": row.peak_start,
                "peak_end": row.peak_end,
                "labels": label_map.get(row.group_name, []),
                "snapshot_at": row.snapshot_at.isoformat() if row.snapshot_at else None,
            }
            for row in groups
        ],
        "rate_changes": [
            {
                "id": event.id,
                "group_name": event.group_name,
                "platform": event.platform,
                "change_type": event.change_type,
                "old_ratio": event.old_ratio,
                "new_ratio": event.new_ratio,
                "change_percent": event.change_percent,
                "detected_at": event.detected_at.isoformat() if event.detected_at else None,
            }
            for event in rate_changes
        ],
        "announcements": [
            {
                "id": row.id,
                "title": row.title,
                "content": row.content,
                "published_at": row.published_at.isoformat() if row.published_at else None,
                "synced_at": row.synced_at.isoformat() if row.synced_at else None,
            }
            for row in announcements
        ],
    }


def build_usage_breakdown(db: Session, instance: Instance, *, days: int = 7) -> dict[str, object]:
    """Upstream usage breakdown (slower, best effort) aggregated by model and group."""
    runtime_settings = get_runtime_app_settings(db)
    since = datetime.now(timezone.utc) - timedelta(days=days)
    try:
        if instance.program_type == "sub2api":
            usage = _collect_sub2api_usage(db, instance, runtime_settings)
        else:
            usage = _collect_newapi_usage(db, instance, runtime_settings, since=since)
        return {"models": usage["models"], "groups": usage["groups"], "error": None}
    except Exception as exc:  # pragma: no cover - upstream dependent
        logger.info("Usage breakdown unavailable for instance %s: %s", instance.id, exc)
        return {"models": [], "groups": [], "error": str(exc)[:200]}


def _group_label_map(db: Session) -> dict[str, list[str]]:
    """Map group name to the labels assigned to it."""
    rows = db.execute(
        select(GroupLabelAssignment.group_name, GroupLabel.name)
        .join(GroupLabel, GroupLabel.id == GroupLabelAssignment.label_id)
        .where(GroupLabelAssignment.enabled.is_(True))
    ).all()
    mapping: dict[str, list[str]] = defaultdict(list)
    for group_name, label_name in rows:
        mapping[group_name].append(label_name)
    return mapping


def _row_created_at(row: dict[str, object]) -> datetime | None:
    """Parse the upstream log timestamp into an aware datetime."""
    raw = row.get("created_at") or row.get("created") or row.get("timestamp")
    if isinstance(raw, (int, float)) and raw > 0:
        return datetime.fromtimestamp(float(raw), tz=timezone.utc)
    if isinstance(raw, str) and raw.strip():
        try:
            parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def _aggregate_rows(rows: list[dict[str, object]], quota_per_unit: float | None) -> dict[str, list[dict[str, object]]]:
    """Aggregate raw upstream log rows by model and group name."""
    models: dict[str, dict[str, float]] = defaultdict(lambda: {"requests": 0.0, "quota": 0.0})
    groups: dict[str, dict[str, float]] = defaultdict(lambda: {"requests": 0.0, "quota": 0.0})

    for row in rows:
        model = str(row.get("model_name") or row.get("model") or "").strip()
        group = str(row.get("group") or row.get("group_name") or "").strip()
        try:
            quota = float(row.get("quota") or row.get("amount") or 0)
        except (TypeError, ValueError):
            quota = 0.0
        try:
            count = float(row.get("count") or 1)
        except (TypeError, ValueError):
            count = 1.0
        if model:
            models[model]["requests"] += count
            models[model]["quota"] += quota
        if group:
            groups[group]["requests"] += count
            groups[group]["quota"] += quota

    def to_rows(source: dict[str, dict[str, float]], key_name: str) -> list[dict[str, object]]:
        items = [
            {
                key_name: name,
                "requests": int(values["requests"]),
                "used_amount": quota_to_display_amount(int(values["quota"]), quota_per_unit) or 0.0,
            }
            for name, values in source.items()
        ]
        items.sort(key=lambda item: float(item["used_amount"] or 0), reverse=True)
        return items[:15]

    return {"models": to_rows(models, "model_name"), "groups": to_rows(groups, "group_name")}


def _collect_newapi_usage(db: Session, instance: Instance, runtime_settings: RuntimeAppSettings, *, since) -> dict[str, list[dict[str, object]]]:
    """Aggregate recent NewAPI self logs by model and group.

    Upstream timestamp filters are unreliable across NewAPI forks (some return
    zero rows when `start_timestamp` is present), so we page newest-first and
    filter locally by the row's `created_at`.
    """
    from app.services.sync_service import _ensure_session, _prepare_instance_client

    client, _status = _prepare_instance_client(instance, runtime_settings)
    session_data = _ensure_session(db, instance, client)
    rows: list[dict[str, object]] = []
    total_seen = 0
    for page in range(1, MAX_LOG_PAGES + 1):
        payload = client.get_user_logs(
            session_data.remote_user_id,
            session_data.cookie_value,
            session_data.access_token,
            page=page,
            page_size=LOG_PAGE_SIZE,
        )
        items = payload.get("items") or []
        if not isinstance(items, list) or not items:
            break
        total_seen += len(items)
        oldest: datetime | None = None
        for item in items:
            if not isinstance(item, dict):
                continue
            created_at = _row_created_at(item)
            if created_at is not None:
                oldest = created_at if oldest is None else min(oldest, created_at)
                if created_at < since:
                    continue
            rows.append(item)
        if len(items) < LOG_PAGE_SIZE:
            break
        if oldest is not None and oldest < since:
            break

    if not total_seen:
        raise RuntimeError("上游未开放用户日志接口，无法统计模型/分组消耗")
    if not rows:
        raise RuntimeError("上游日志里没有最近 %s 天的记录" % (since.date(),))
    return _aggregate_rows(rows, instance.quota_per_unit)


def _collect_sub2api_usage(db: Session, instance: Instance, runtime_settings: RuntimeAppSettings) -> dict[str, list[dict[str, object]]]:
    """Read Sub2API usage dashboard per-model rows."""
    from app.services.sync_service import _build_sub2api_client, _ensure_sub2api_session

    client = _build_sub2api_client(instance, runtime_settings)
    session_data = _ensure_sub2api_session(db, instance, client)
    raw_items = client.get_model_usage(session_data)
    models: list[dict[str, object]] = []
    for row in raw_items:
        if not isinstance(row, dict):
            continue
        name = str(row.get("model") or row.get("model_name") or row.get("name") or "").strip()
        if not name:
            continue
        cost = row.get("actual_cost") or row.get("cost") or row.get("used_amount") or 0
        requests = row.get("request_count") or row.get("requests") or row.get("count") or 0
        try:
            cost_value = float(cost)
        except (TypeError, ValueError):
            cost_value = 0.0
        try:
            requests_value = int(requests)
        except (TypeError, ValueError):
            requests_value = 0
        models.append({"model_name": name, "requests": requests_value, "used_amount": round(cost_value, 4)})
    models.sort(key=lambda item: float(item["used_amount"] or 0), reverse=True)
    return {"models": models[:15], "groups": []}
