"""Reusable snapshot-derived metrics used by dashboard and instance pages."""

from __future__ import annotations

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.time import utcnow
from app.models import Instance, UserSnapshot


def quota_to_display_amount(value: int | None, quota_per_unit: float | None) -> float | None:
    """Convert internal quota units into the user-visible amount."""
    if value is None or not quota_per_unit or quota_per_unit <= 0:
        return None
    return value / quota_per_unit


def uses_postpaid_billing(instance: Instance) -> bool:
    """Return whether the instance is configured for postpaid billing."""
    return instance.billing_mode == "postpaid"


def current_day_start_utc(timezone_name: str) -> datetime:
    """Return the current local-day boundary converted into naive UTC."""
    try:
        tzinfo = ZoneInfo(timezone_name)
    except Exception:
        tzinfo = timezone.utc

    now_local = utcnow().replace(tzinfo=timezone.utc).astimezone(tzinfo)
    day_start_local = datetime.combine(now_local.date(), time.min, tzinfo=tzinfo)
    return day_start_local.astimezone(timezone.utc).replace(tzinfo=None)


def today_request_count(
    db: Session,
    instance_id: int,
    latest_snapshot: UserSnapshot | None,
    day_start_utc: datetime,
) -> int:
    """Estimate today's request growth from stored cumulative counters."""
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

    if latest_snapshot.snapshot_at >= day_start_utc:
        return max(latest_snapshot.request_count, 0)

    return 0
