"""Database migration helpers."""

from __future__ import annotations

import logging
from pathlib import Path

from alembic import command
from alembic.config import Config


logger = logging.getLogger(__name__)


def run_startup_migrations() -> None:
    """Upgrade the configured database to the latest Alembic revision."""
    project_root = Path(__file__).resolve().parents[2]
    alembic_ini = project_root / "alembic.ini"
    if not alembic_ini.exists():
        logger.warning("Alembic config not found at %s; skipping startup migrations.", alembic_ini)
        return

    config = Config(str(alembic_ini))
    logger.info("Running database migrations to Alembic head.")
    command.upgrade(config, "head")
    logger.info("Database migrations completed.")
