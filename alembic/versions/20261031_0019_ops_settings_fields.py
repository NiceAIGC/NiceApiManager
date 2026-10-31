"""Add rate-change, announcement, and retention settings fields.

Revision ID: 20261031_0019
Revises: 20261026_0018
Create Date: 2026-10-31
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261031_0019"
down_revision = "20261026_0018"
branch_labels = None
depends_on = None

_NEW_COLUMNS = [
    ("rate_change_notify_enabled", sa.Boolean()),
    ("rate_change_min_percent", sa.Float()),
    ("rate_change_cooldown_minutes", sa.Integer()),
    ("announcement_sync_enabled", sa.Boolean()),
    ("announcement_notify_enabled", sa.Boolean()),
    ("retention_sync_runs_days", sa.Integer()),
    ("retention_notification_logs_days", sa.Integer()),
    ("retention_daily_usage_days", sa.Integer()),
    ("retention_rate_changes_days", sa.Integer()),
    ("retention_announcements_days", sa.Integer()),
]


def upgrade() -> None:
    """Add the new nullable settings columns."""
    with op.batch_alter_table("app_settings") as batch_op:
        for name, column_type in _NEW_COLUMNS:
            batch_op.add_column(sa.Column(name, column_type, nullable=True))


def downgrade() -> None:
    """Drop the settings columns added in this revision."""
    with op.batch_alter_table("app_settings") as batch_op:
        for name, _ in _NEW_COLUMNS:
            batch_op.drop_column(name)
