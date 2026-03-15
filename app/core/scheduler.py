"""Scheduler bootstrap kept for future periodic sync support."""

from apscheduler.schedulers.background import BackgroundScheduler

from app.core.config import Settings


def build_scheduler(settings: Settings) -> BackgroundScheduler:
    """Prepare a scheduler instance without starting any background jobs yet."""
    scheduler = BackgroundScheduler(timezone=settings.scheduler_timezone)
    # Intentionally left without jobs. The project currently exposes only manual sync.
    return scheduler

