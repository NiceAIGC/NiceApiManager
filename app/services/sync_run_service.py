"""Sync history query helpers."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Instance, SyncRun
from app.schemas.sync_run import SyncRunListItem, SyncRunListResponse


def list_sync_runs(
    db: Session,
    instance_id: int | None = None,
    offset: int = 0,
    limit: int = 50,
) -> SyncRunListResponse:
    """Return sync history with the associated instance name."""
    stmt = (
        select(SyncRun, Instance.name)
        .join(Instance, Instance.id == SyncRun.instance_id)
        .order_by(SyncRun.started_at.desc(), SyncRun.id.desc())
        .offset(offset)
        .limit(limit)
    )
    count_stmt = select(func.count(SyncRun.id))

    if instance_id is not None:
        stmt = stmt.where(SyncRun.instance_id == instance_id)
        count_stmt = count_stmt.where(SyncRun.instance_id == instance_id)

    rows = db.execute(stmt).all()
    total = db.scalar(count_stmt) or 0

    return SyncRunListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[
            SyncRunListItem(
                id=sync_run.id,
                instance_id=sync_run.instance_id,
                instance_name=instance_name,
                trigger_type=sync_run.trigger_type,
                status=sync_run.status,
                started_at=sync_run.started_at,
                finished_at=sync_run.finished_at,
                duration_ms=sync_run.duration_ms,
                error_message=sync_run.error_message,
                summary_json=sync_run.summary_json,
            )
            for sync_run, instance_name in rows
        ],
    )

