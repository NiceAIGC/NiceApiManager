"""Add health alert opt-in column for instances.

Revision ID: 20261103_0023
Revises: 20261102_0022
Create Date: 2026-11-03
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "20261103_0023"
down_revision = "20261102_0022"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the per-instance health alert opt-in flag."""
    with op.batch_alter_table("instances") as batch_op:
        batch_op.add_column(sa.Column("health_alert_enabled", sa.Boolean(), nullable=True))


def downgrade() -> None:
    """Drop the health alert opt-in flag."""
    with op.batch_alter_table("instances") as batch_op:
        batch_op.drop_column("health_alert_enabled")
