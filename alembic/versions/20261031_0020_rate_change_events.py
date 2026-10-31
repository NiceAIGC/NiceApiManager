"""Add rate_change_events table.

Revision ID: 20261031_0020
Revises: 20261031_0019
Create Date: 2026-10-31
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261031_0020"
down_revision = "20261031_0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the rate_change_events table."""
    op.create_table(
        "rate_change_events",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("group_name", sa.String(length=100), nullable=False),
        sa.Column("platform", sa.String(length=64), nullable=True),
        sa.Column("change_type", sa.String(length=16), nullable=False),
        sa.Column("old_ratio", sa.Float(), nullable=True),
        sa.Column("new_ratio", sa.Float(), nullable=True),
        sa.Column("change_percent", sa.Float(), nullable=True),
        sa.Column("notified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("detected_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_rate_change_events_instance_id", "rate_change_events", ["instance_id"])
    op.create_index("ix_rate_change_events_detected_at", "rate_change_events", ["detected_at"])


def downgrade() -> None:
    """Drop the rate_change_events table."""
    op.drop_index("ix_rate_change_events_detected_at", table_name="rate_change_events")
    op.drop_index("ix_rate_change_events_instance_id", table_name="rate_change_events")
    op.drop_table("rate_change_events")
