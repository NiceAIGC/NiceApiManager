"""Add notification channel groups to settings and instances.

Revision ID: 20261026_0018
Revises: 20261020_0017
Create Date: 2026-10-26
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261026_0018"
down_revision = "20261020_0017"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add JSON columns storing channel-group references."""
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("notification_channel_groups_json", sa.JSON(), nullable=True))
    with op.batch_alter_table("instances") as batch_op:
        batch_op.add_column(sa.Column("notification_channel_group_ids_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    """Drop the channel-group JSON columns."""
    with op.batch_alter_table("instances") as batch_op:
        batch_op.drop_column("notification_channel_group_ids_json")
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("notification_channel_groups_json")
