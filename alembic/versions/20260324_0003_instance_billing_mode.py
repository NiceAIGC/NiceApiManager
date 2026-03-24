"""Add instance billing mode."""

from alembic import op
import sqlalchemy as sa


revision = "20260324_0003"
down_revision = "20260315_0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add billing mode so prepaid and postpaid instances can be distinguished."""
    op.add_column(
        "instances",
        sa.Column("billing_mode", sa.String(length=16), nullable=False, server_default="prepaid"),
    )


def downgrade() -> None:
    """Drop the billing mode column."""
    op.drop_column("instances", "billing_mode")
