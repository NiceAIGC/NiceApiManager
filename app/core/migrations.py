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
    _encrypt_existing_secrets()


def _encrypt_existing_secrets() -> None:
    """Rewrite legacy plaintext secret columns with their encrypted form.

    Idempotent: values already carrying the enc:v1: prefix are skipped.
    """
    from sqlalchemy import text

    from app.core.crypto import ENCRYPTED_PREFIX, encrypt_value
    from app.core.database import SessionLocal

    targets: list[tuple[str, str, str]] = [
        ("instances", "id", "password"),
        ("instances", "id", "access_token"),
        ("instance_sessions", "id", "cookie_value"),
        ("instance_sessions", "id", "access_token"),
        ("instance_sessions", "id", "refresh_token"),
        ("app_settings", "id", "shared_socks5_proxy_url"),
    ]

    db = SessionLocal()
    try:
        rewritten = 0
        for table, pk_column, column in targets:
            rows = db.execute(text(f"SELECT {pk_column}, {column} FROM {table} WHERE {column} IS NOT NULL AND {column} != ''")).all()  # noqa: S608
            for row_id, value in rows:
                if not isinstance(value, str) or value.startswith(ENCRYPTED_PREFIX):
                    continue
                db.execute(
                    text(f"UPDATE {table} SET {column} = :value WHERE {pk_column} = :row_id"),  # noqa: S608
                    {"value": encrypt_value(value), "row_id": row_id},
                )
                rewritten += 1

        settings_row = db.execute(text("SELECT id, notification_channels_json FROM app_settings WHERE notification_channels_json IS NOT NULL")).first()
        if settings_row and isinstance(settings_row[1], list):
            changed = False
            channels = []
            for item in settings_row[1]:
                if isinstance(item, dict) and isinstance(item.get("apprise_url"), str) and item["apprise_url"] and not item["apprise_url"].startswith(ENCRYPTED_PREFIX):
                    item = {**item, "apprise_url": encrypt_value(item["apprise_url"])}
                    changed = True
                channels.append(item)
            if changed:
                import json as _json

                db.execute(
                    text("UPDATE app_settings SET notification_channels_json = :value WHERE id = :row_id"),
                    {"value": _json.dumps(channels, ensure_ascii=False), "row_id": settings_row[0]},
                )
                rewritten += 1

        db.commit()
        if rewritten:
            logger.info("已加密 %d 处历史明文敏感字段。", rewritten)
    except Exception:
        db.rollback()
        logger.exception("历史敏感字段加密迁移失败。")
    finally:
        db.close()
