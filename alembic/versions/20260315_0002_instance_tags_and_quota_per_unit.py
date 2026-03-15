"""Add instance tags and quota_per_unit."""

from alembic import op
import sqlalchemy as sa


revision = "20260315_0002"
down_revision = "20260315_0001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add instance metadata needed for filtering and display conversions."""
    op.add_column("instances", sa.Column("tags_json", sa.JSON(), nullable=True))
    op.add_column("instances", sa.Column("quota_per_unit", sa.Float(), nullable=True))


def downgrade() -> None:
    """Drop instance metadata columns."""
    op.drop_column("instances", "quota_per_unit")
    op.drop_column("instances", "tags_json")
