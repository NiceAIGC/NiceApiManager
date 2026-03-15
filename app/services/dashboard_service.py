"""Dashboard aggregation service."""

from datetime import datetime, time, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import String, cast, select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utcnow
from app.models import Instance, UserSnapshot
from app.schemas.dashboard import DashboardInstanceSummary, DashboardOverviewResponse


settings = get_settings()


def _tag_filtered_instances(db: Session, tag: str | None) -> list[Instance]:
    """Return instances optionally filtered by one tag."""
    stmt = select(Instance).order_by(Instance.id.asc())
    if tag:
        pattern = f'%"{tag.strip()}"%'
        stmt = stmt.where(cast(Instance.tags_json, String).like(pattern))
    return db.scalars(stmt).all()


def _quota_to_display_amount(value: int | None, quota_per_unit: float | None) -> float | None:
    """Convert internal quota units into the user-visible amount."""
    if value is None or not quota_per_unit or quota_per_unit <= 0:
        return None
    return value / quota_per_unit


def _current_day_start_utc() -> datetime:
    """Return the current local-day boundary converted into naive UTC."""
    try:
        tzinfo = ZoneInfo(settings.scheduler_timezone)
    except Exception:
        tzinfo = timezone.utc

    now_local = utcnow().replace(tzinfo=timezone.utc).astimezone(tzinfo)
    day_start_local = datetime.combine(now_local.date(), time.min, tzinfo=tzinfo)
    return day_start_local.astimezone(timezone.utc).replace(tzinfo=None)


def _today_request_count(
    db: Session,
    instance_id: int,
    latest_snapshot: UserSnapshot | None,
    day_start_utc: datetime,
) -> int:
    """Estimate today's request growth from stored cumulative counters."""
    if latest_snapshot is None or latest_snapshot.snapshot_at < day_start_utc:
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

    first_today_snapshot = db.scalars(
        select(UserSnapshot)
        .where(
            UserSnapshot.instance_id == instance_id,
            UserSnapshot.snapshot_at >= day_start_utc,
        )
        .order_by(UserSnapshot.snapshot_at.asc())
        .limit(1)
    ).first()
    if first_today_snapshot is None:
        return 0

    return max(latest_snapshot.request_count - first_today_snapshot.request_count, 0)


def build_dashboard_overview(db: Session, tag: str | None = None) -> DashboardOverviewResponse:
    """Aggregate latest snapshot values for each configured instance."""
    instances = _tag_filtered_instances(db, tag)
    day_start_utc = _current_day_start_utc()

    items: list[DashboardInstanceSummary] = []
    total_quota = 0
    total_used_quota = 0
    total_display_quota = 0.0
    total_display_used_quota = 0.0
    total_request_count = 0
    today_request_count = 0
    healthy_instance_count = 0
    unhealthy_instance_count = 0

    for instance in instances:
        latest_snapshot = db.scalars(
            select(UserSnapshot)
            .where(UserSnapshot.instance_id == instance.id)
            .order_by(UserSnapshot.snapshot_at.desc())
            .limit(1)
        ).first()

        if instance.last_health_status == "healthy":
            healthy_instance_count += 1
        elif instance.last_health_status in {"degraded", "unhealthy"}:
            unhealthy_instance_count += 1

        if latest_snapshot:
            total_quota += latest_snapshot.quota
            total_used_quota += latest_snapshot.used_quota
            total_request_count += latest_snapshot.request_count
            total_display_quota += _quota_to_display_amount(latest_snapshot.quota, instance.quota_per_unit) or 0.0
            total_display_used_quota += (
                _quota_to_display_amount(latest_snapshot.used_quota, instance.quota_per_unit) or 0.0
            )

        instance_today_request_count = _today_request_count(db, instance.id, latest_snapshot, day_start_utc)
        today_request_count += instance_today_request_count

        items.append(
            DashboardInstanceSummary(
                instance_id=instance.id,
                instance_name=instance.name,
                enabled=instance.enabled,
                tags=instance.tags_json or [],
                quota_per_unit=instance.quota_per_unit,
                health_status=instance.last_health_status,
                health_error=instance.last_health_error,
                last_sync_at=instance.last_sync_at,
                latest_group_name=latest_snapshot.group_name if latest_snapshot else None,
                latest_quota=latest_snapshot.quota if latest_snapshot else None,
                latest_used_quota=latest_snapshot.used_quota if latest_snapshot else None,
                latest_display_quota=_quota_to_display_amount(
                    latest_snapshot.quota if latest_snapshot else None,
                    instance.quota_per_unit,
                ),
                latest_display_used_quota=_quota_to_display_amount(
                    latest_snapshot.used_quota if latest_snapshot else None,
                    instance.quota_per_unit,
                ),
                latest_request_count=latest_snapshot.request_count if latest_snapshot else None,
                today_request_count=instance_today_request_count,
            )
        )

    return DashboardOverviewResponse(
        instance_count=len(instances),
        enabled_instance_count=sum(1 for instance in instances if instance.enabled),
        healthy_instance_count=healthy_instance_count,
        unhealthy_instance_count=unhealthy_instance_count,
        total_quota=total_quota,
        total_used_quota=total_used_quota,
        total_display_quota=total_display_quota,
        total_display_used_quota=total_display_used_quota,
        total_request_count=total_request_count,
        today_request_count=today_request_count,
        items=items,
    )
