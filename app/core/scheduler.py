"""Scheduler bootstrap for periodic sync support."""

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import Settings
from app.services.notification_service import run_notification_monitoring_pass
from app.services.sync_service import run_scheduled_sync_pass


def build_scheduler(settings: Settings) -> BackgroundScheduler:
    """Prepare the background scheduler and its recurring sync job."""
    scheduler = BackgroundScheduler(timezone=settings.scheduler_timezone)
    scheduler.add_job(
        run_scheduled_sync_pass,
        trigger="interval",
        minutes=1,
        id="instance-periodic-sync",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=30,
    )
    scheduler.add_job(
        run_notification_monitoring_pass,
        trigger="interval",
        minutes=1,
        id="notification-monitoring",
        replace_existing=True,
        coalesce=True,
        max_instances=1,
        misfire_grace_time=30,
    )
    return scheduler
