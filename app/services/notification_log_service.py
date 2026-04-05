"""Notification history query helpers."""

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models import Instance, NotificationLog
from app.schemas.notification_log import NotificationLogListResponse, NotificationLogResponse


def list_notification_logs(
    db: Session,
    *,
    instance_id: int | None = None,
    source_type: str | None = None,
    offset: int = 0,
    limit: int = 50,
) -> NotificationLogListResponse:
    """Return notification history with optional filters."""
    stmt = (
        select(NotificationLog, Instance.name)
        .join(Instance, Instance.id == NotificationLog.instance_id, isouter=True)
        .order_by(NotificationLog.created_at.desc(), NotificationLog.id.desc())
        .offset(offset)
        .limit(limit)
    )
    count_stmt = select(func.count(NotificationLog.id))

    if instance_id is not None:
        stmt = stmt.where(NotificationLog.instance_id == instance_id)
        count_stmt = count_stmt.where(NotificationLog.instance_id == instance_id)

    if source_type:
        stmt = stmt.where(NotificationLog.source_type == source_type)
        count_stmt = count_stmt.where(NotificationLog.source_type == source_type)

    rows = db.execute(stmt).all()
    total = db.scalar(count_stmt) or 0

    return NotificationLogListResponse(
        total=total,
        offset=offset,
        limit=limit,
        items=[
            NotificationLogResponse(
                id=log.id,
                instance_id=log.instance_id,
                instance_name=instance_name,
                rule_type=log.rule_type,
                rule_id=log.rule_id,
                rule_name=log.rule_name,
                event_type=log.event_type,
                source_type=log.source_type,
                target_key=log.target_key,
                title=log.title,
                body=log.body,
                notify_type=log.notify_type,
                delivery_status=log.delivery_status,
                channels_json=log.channels_json,
                error_message=log.error_message,
                created_at=log.created_at,
            )
            for log, instance_name in rows
        ],
    )
