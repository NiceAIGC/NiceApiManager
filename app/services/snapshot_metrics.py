"""Reusable snapshot-derived metrics used by dashboard and instance pages."""

from __future__ import annotations

from datetime import date, datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import DailyUsageStat, Instance, UserSnapshot


def quota_to_display_amount(value: int | None, quota_per_unit: float | None) -> float | None:
    """Convert internal quota units into the user-visible amount."""
    if value is None or not quota_per_unit or quota_per_unit <= 0:
        return None
    return value / quota_per_unit


def uses_postpaid_billing(instance: Instance) -> bool:
    """Return whether the instance is configured for postpaid billing."""
    return instance.billing_mode == "postpaid"


def resolve_timezone(timezone_name: str):
    """Resolve a timezone string and gracefully fall back to UTC."""
    try:
        return ZoneInfo(timezone_name)
    except Exception:
        return timezone.utc


def current_day_start_utc(timezone_name: str) -> datetime:
    """Return the current local-day boundary converted into naive UTC."""
    tzinfo = resolve_timezone(timezone_name)

    now_local = utcnow().replace(tzinfo=timezone.utc).astimezone(tzinfo)
    day_start_local = datetime.combine(now_local.date(), time.min, tzinfo=tzinfo)
    return day_start_local.astimezone(timezone.utc).replace(tzinfo=None)


def current_local_date(timezone_name: str) -> date:
    """Return the current date in the configured business timezone."""
    tzinfo = resolve_timezone(timezone_name)
    return utcnow().replace(tzinfo=timezone.utc).astimezone(tzinfo).date()


def get_daily_usage_stat(
    db: Session,
    instance_id: int,
    usage_date: date,
) -> DailyUsageStat | None:
    """Return the stored daily usage stat for one instance and date when available."""
    return db.scalars(
        select(DailyUsageStat)
        .where(
            DailyUsageStat.instance_id == instance_id,
            DailyUsageStat.usage_date == usage_date,
        )
        .limit(1)
    ).first()


def today_request_count(
    db: Session,
    instance_id: int,
    latest_snapshot: UserSnapshot | None,
    day_start_utc: datetime,
    timezone_name: str | None = None,
) -> int:
    """Estimate today's request growth from stored cumulative counters."""
    if timezone_name:
        today_stat = get_daily_usage_stat(db, instance_id, current_local_date(timezone_name))
        if today_stat is not None:
            return max(today_stat.request_count, 0)

    if latest_snapshot is None:
        return 0

    baseline_snapshot = db.scalars(
        select(UserSnapshot)
        .where(
            UserSnapshot.instance_id == instance_id,
            UserSnapshot.snapshot_at < day_start_utc,
        )
        .order_by(UserSnapshot.snapshot_at.desc())
        .limit(1)
    ).first()
    if baseline_snapshot is not None:
        return max(latest_snapshot.request_count - baseline_snapshot.request_count, 0)

    return 0
