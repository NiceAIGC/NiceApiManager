"""Add api_keys table and per-instance notification toggles.

Revision ID: 20261102_0022
Revises: 20261031_0021
Create Date: 2026-11-02
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261102_0022"
down_revision = "20261031_0021"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create api_keys and add per-instance notification opt-out columns."""
    op.create_table(
        "api_keys",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("key_prefix", sa.String(length=16), nullable=False),
        sa.Column("key_hash", sa.String(length=64), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint("key_hash"),
    )
    with op.batch_alter_table("instances") as batch_op:
        batch_op.add_column(sa.Column("notify_rate_changes", sa.Boolean(), nullable=True))
        batch_op.add_column(sa.Column("notify_announcements", sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Drop api_keys and the notification opt-out columns."""
    with op.batch_alter_table("instances") as batch_op:
        batch_op.drop_column("notify_announcements")
        batch_op.drop_column("notify_rate_changes")
    op.drop_table("api_keys")
