"""Retention cleanup for historical tables."""

from __future__ import annotations

from datetime import timedelta
import logging

from sqlalchemy import delete
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.time import utcnow
from app.models import Announcement, DailyUsageStat, NotificationLog, RateChangeEvent, SyncRun
from app.services.app_setting_service import RuntimeAppSettings, get_runtime_app_settings


logger = logging.getLogger(__name__)


def run_retention_cleanup(db: Session, runtime_settings: RuntimeAppSettings) -> dict[str, int]:
    """Delete rows older than the configured retention windows.

    Returns the number of deleted rows per table.
    """
    now = utcnow()
    removed: dict[str, int] = {}

    sync_runs_before = now - timedelta(days=runtime_settings.retention_sync_runs_days)
    removed["sync_runs"] = db.execute(delete(SyncRun).where(SyncRun.started_at < sync_runs_before)).rowcount

    logs_before = now - timedelta(days=runtime_settings.retention_notification_logs_days)
    removed["notification_logs"] = db.execute(delete(NotificationLog).where(NotificationLog.created_at < logs_before)).rowcount

    usage_before = (now - timedelta(days=runtime_settings.retention_daily_usage_days)).date()
    removed["daily_usage_stats"] = db.execute(delete(DailyUsageStat).where(DailyUsageStat.usage_date < usage_before)).rowcount

    rate_changes_before = now - timedelta(days=runtime_settings.retention_rate_changes_days)
    removed["rate_change_events"] = db.execute(delete(RateChangeEvent).where(RateChangeEvent.detected_at < rate_changes_before)).rowcount

    announcements_before = now - timedelta(days=runtime_settings.retention_announcements_days)
    removed["announcements"] = db.execute(delete(Announcement).where(Announcement.synced_at < announcements_before)).rowcount

    db.commit()
    return removed


def run_retention_cleanup_pass() -> None:
    """Scheduler entry point: open a session and clean expired rows."""
    db = SessionLocal()
    try:
        runtime_settings = get_runtime_app_settings(db)
        removed = run_retention_cleanup(db, runtime_settings)
        if any(removed.values()):
            logger.info("Retention cleanup removed rows: %s", removed)
    except Exception:
        logger.exception("Retention cleanup failed.")
    finally:
        db.close()
