"""Dashboard aggregation and trend services."""

from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import get_settings
from app.core.time import utcnow
from app.models import DailyUsageStat, Instance, UserSnapshot
from app.schemas.dashboard import (
    DashboardInstanceSummary,
    DashboardOverviewResponse,
    DashboardTrendPoint,
    DashboardTrendResponse,
)
from app.services.instance_filters import apply_instance_filters
from app.services.snapshot_metrics import (
    current_day_start_utc,
    quota_to_display_amount,
    resolve_timezone,
    today_request_count,
    uses_postpaid_billing,
)


settings = get_settings()


def _filtered_instances(
    db: Session,
    *,
    search: str | None = None,
    tags: str | list[str] | None = None,
    billing_mode: str | None = None,
    enabled: bool | None = None,
    health_status: str | None = None,
) -> list[Instance]:
    """Return instances filtered with the shared instance filter set."""
    stmt = select(Instance).order_by(Instance.id.asc())
    stmt = apply_instance_filters(
        stmt,
        search=search,
        tags=tags,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )
    return db.scalars(stmt).all()


def build_dashboard_overview(
    db: Session,
    *,
    search: str | None = None,
    tags: str | list[str] | None = None,
    billing_mode: str | None = None,
    enabled: bool | None = None,
    health_status: str | None = None,
) -> DashboardOverviewResponse:
    """Aggregate latest snapshot values for the filtered instance set."""
    instances = _filtered_instances(
        db,
        search=search,
        tags=tags,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )
    day_start_utc = current_day_start_utc(settings.scheduler_timezone)

    items: list[DashboardInstanceSummary] = []
    total_quota = 0
    total_used_quota = 0
    total_display_quota = 0.0
    total_display_used_quota = 0.0
    total_request_count = 0
    today_request_count_total = 0
    healthy_instance_count = 0
    unhealthy_instance_count = 0
    prepaid_instance_count = 0
    postpaid_instance_count = 0

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

        if uses_postpaid_billing(instance):
            postpaid_instance_count += 1
        else:
            prepaid_instance_count += 1

        if latest_snapshot:
            total_used_quota += latest_snapshot.used_quota
            total_request_count += latest_snapshot.request_count
            total_display_used_quota += (
                quota_to_display_amount(latest_snapshot.used_quota, instance.quota_per_unit) or 0.0
            )
            if not uses_postpaid_billing(instance):
                total_quota += latest_snapshot.quota
                total_display_quota += (
                    quota_to_display_amount(latest_snapshot.quota, instance.quota_per_unit) or 0.0
                )

        instance_today_request_count = today_request_count(
            db,
            instance.id,
            latest_snapshot,
            day_start_utc,
            settings.scheduler_timezone,
        )
        today_request_count_total += instance_today_request_count

        items.append(
            DashboardInstanceSummary(
                instance_id=instance.id,
                instance_name=instance.name,
                enabled=instance.enabled,
                billing_mode=instance.billing_mode,
                tags=instance.tags_json or [],
                quota_per_unit=instance.quota_per_unit,
                health_status=instance.last_health_status,
                health_error=instance.last_health_error,
                last_sync_at=instance.last_sync_at,
                latest_group_name=latest_snapshot.group_name if latest_snapshot else None,
                latest_quota=(
                    None
                    if uses_postpaid_billing(instance)
                    else (latest_snapshot.quota if latest_snapshot else None)
                ),
                latest_used_quota=latest_snapshot.used_quota if latest_snapshot else None,
                latest_display_quota=(
                    None
                    if uses_postpaid_billing(instance)
                    else quota_to_display_amount(
                        latest_snapshot.quota if latest_snapshot else None,
                        instance.quota_per_unit,
                    )
                ),
                latest_display_used_quota=quota_to_display_amount(
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
        prepaid_instance_count=prepaid_instance_count,
        postpaid_instance_count=postpaid_instance_count,
        total_quota=total_quota,
        total_used_quota=total_used_quota,
        total_display_quota=total_display_quota,
        total_display_used_quota=total_display_used_quota,
        total_request_count=total_request_count,
        today_request_count=today_request_count_total,
        items=items,
    )


def build_dashboard_trends(
    db: Session,
    *,
    days: int = 7,
    search: str | None = None,
    tags: str | list[str] | None = None,
    billing_mode: str | None = None,
    enabled: bool | None = None,
    health_status: str | None = None,
) -> DashboardTrendResponse:
    """Aggregate daily consumption and request-count deltas for charts."""
    normalized_days = 30 if days >= 30 else 7
    instances = _filtered_instances(
        db,
        search=search,
        tags=tags,
        billing_mode=billing_mode,
        enabled=enabled,
        health_status=health_status,
    )

    tzinfo = resolve_timezone(settings.scheduler_timezone)

    today_local = utcnow().replace(tzinfo=timezone.utc).astimezone(tzinfo).date()
    day_windows: list[tuple[date, str, str, datetime, datetime]] = []
    for offset in range(normalized_days):
        current_date = today_local - timedelta(days=normalized_days - offset - 1)
        day_start_local = datetime.combine(current_date, time.min, tzinfo=tzinfo)
        day_end_local = day_start_local + timedelta(days=1)
        day_windows.append(
            (
                current_date,
                current_date.isoformat(),
                current_date.strftime("%m-%d"),
                day_start_local.astimezone(timezone.utc).replace(tzinfo=None),
                day_end_local.astimezone(timezone.utc).replace(tzinfo=None),
            )
        )

    if not day_windows:
        return DashboardTrendResponse(days=normalized_days, points=[])

    first_date = day_windows[0][0]
    last_date = day_windows[-1][0]
    first_start_utc = day_windows[0][3]
    last_end_utc = day_windows[-1][4]
    used_amounts = [0.0 for _ in day_windows]
    request_counts = [0 for _ in day_windows]

    for instance in instances:
        daily_stats = db.scalars(
            select(DailyUsageStat)
            .where(
                DailyUsageStat.instance_id == instance.id,
                DailyUsageStat.usage_date >= first_date,
                DailyUsageStat.usage_date <= last_date,
            )
            .order_by(DailyUsageStat.usage_date.asc())
        ).all()
        if daily_stats:
            stats_by_date = {row.usage_date: row for row in daily_stats}
            for index, (current_date, _, _, _, _) in enumerate(day_windows):
                daily_stat = stats_by_date.get(current_date)
                if daily_stat is None:
                    continue
                used_amounts[index] += daily_stat.used_display_amount
                request_counts[index] += daily_stat.request_count
            continue

        baseline_snapshot = db.scalars(
            select(UserSnapshot)
            .where(
                UserSnapshot.instance_id == instance.id,
                UserSnapshot.snapshot_at < first_start_utc,
            )
            .order_by(UserSnapshot.snapshot_at.desc())
            .limit(1)
        ).first()
        snapshots = db.scalars(
            select(UserSnapshot)
            .where(
                UserSnapshot.instance_id == instance.id,
                UserSnapshot.snapshot_at >= first_start_utc,
                UserSnapshot.snapshot_at < last_end_utc,
            )
            .order_by(UserSnapshot.snapshot_at.asc())
        ).all()

        pointer = 0
        previous_snapshot = baseline_snapshot
        current_snapshot = baseline_snapshot

        for index, (_, _, _, _, day_end_utc) in enumerate(day_windows):
            while pointer < len(snapshots) and snapshots[pointer].snapshot_at < day_end_utc:
                current_snapshot = snapshots[pointer]
                pointer += 1

            if current_snapshot is None:
                continue

            previous_used = previous_snapshot.used_quota if previous_snapshot else None
            previous_requests = previous_snapshot.request_count if previous_snapshot else None
            used_delta = current_snapshot.used_quota if previous_used is None else current_snapshot.used_quota - previous_used
            request_delta = (
                current_snapshot.request_count
                if previous_requests is None
                else current_snapshot.request_count - previous_requests
            )

            used_amounts[index] += quota_to_display_amount(max(used_delta, 0), instance.quota_per_unit) or 0.0
            request_counts[index] += max(request_delta, 0)
            previous_snapshot = current_snapshot

    return DashboardTrendResponse(
        days=normalized_days,
        points=[
            DashboardTrendPoint(
                date=date_text,
                label=label,
                used_display_amount=used_amounts[index],
                request_count=request_counts[index],
            )
            for index, (_, date_text, label, _, _) in enumerate(day_windows)
        ],
    )
