"""Add announcements table.

Revision ID: 20261031_0021
Revises: 20261031_0020
Create Date: 2026-10-31
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261031_0021"
down_revision = "20261031_0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the announcements table."""
    op.create_table(
        "announcements",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("instance_id", sa.Integer(), sa.ForeignKey("instances.id", ondelete="CASCADE"), nullable=False),
        sa.Column("source_id", sa.String(length=128), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("notified", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.UniqueConstraint("instance_id", "source_id"),
    )
    op.create_index("ix_announcements_instance_id", "announcements", ["instance_id"])
    op.create_index("ix_announcements_synced_at", "announcements", ["synced_at"])


def downgrade() -> None:
    """Drop the announcements table."""
    op.drop_index("ix_announcements_synced_at", table_name="announcements")
    op.drop_index("ix_announcements_instance_id", table_name="announcements")
    op.drop_table("announcements")
