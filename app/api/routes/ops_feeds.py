"""Rate-change events and upstream announcement query routes."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.models import Announcement, Instance, RateChangeEvent

router = APIRouter()


@router.get("/rate-changes")
def list_rate_changes(
    instance_id: int | None = Query(default=None, description="按实例筛选。"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """List detected rate change events, newest first."""
    stmt = select(RateChangeEvent, Instance.name).join(Instance, Instance.id == RateChangeEvent.instance_id)
    count_stmt = select(func.count(RateChangeEvent.id))
    if instance_id is not None:
        stmt = stmt.where(RateChangeEvent.instance_id == instance_id)
        count_stmt = count_stmt.where(RateChangeEvent.instance_id == instance_id)
    total = db.scalar(count_stmt) or 0
    rows = db.execute(
        stmt.order_by(RateChangeEvent.detected_at.desc(), RateChangeEvent.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "total": total,
        "items": [
            {
                "id": event.id,
                "instance_id": event.instance_id,
                "instance_name": instance_name,
                "group_name": event.group_name,
                "platform": event.platform,
                "change_type": event.change_type,
                "old_ratio": event.old_ratio,
                "new_ratio": event.new_ratio,
                "change_percent": event.change_percent,
                "notified": event.notified,
                "detected_at": event.detected_at.isoformat() if event.detected_at else None,
            }
            for event, instance_name in rows
        ],
    }


@router.get("/announcements")
def list_announcements(
    instance_id: int | None = Query(default=None, description="按实例筛选。"),
    page: int = Query(default=1, ge=1),
    page_size: int = Query(default=20, ge=1, le=200),
    db: Session = Depends(get_db),
) -> dict[str, object]:
    """List synced upstream announcements, newest first."""
    stmt = select(Announcement, Instance.name).join(Instance, Instance.id == Announcement.instance_id)
    count_stmt = select(func.count(Announcement.id))
    if instance_id is not None:
        stmt = stmt.where(Announcement.instance_id == instance_id)
        count_stmt = count_stmt.where(Announcement.instance_id == instance_id)
    total = db.scalar(count_stmt) or 0
    rows = db.execute(
        stmt.order_by(Announcement.published_at.desc().nullslast(), Announcement.synced_at.desc(), Announcement.id.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    ).all()
    return {
        "total": total,
        "items": [
            {
                "id": row.id,
                "instance_id": row.instance_id,
                "instance_name": instance_name,
                "title": row.title,
                "content": row.content,
                "published_at": row.published_at.isoformat() if row.published_at else None,
                "synced_at": row.synced_at.isoformat() if row.synced_at else None,
                "notified": row.notified,
            }
            for row, instance_name in rows
        ],
    }
