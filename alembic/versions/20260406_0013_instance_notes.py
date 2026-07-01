"""Add instance notes."""

from alembic import op
import sqlalchemy as sa


revision = "20260406_0013"
down_revision = "20260406_0012"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    """Return whether the current database already contains the target column."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Persist optional operator notes for instances."""
    if not _has_column("instances", "remark"):
        op.add_column("instances", sa.Column("remark", sa.String(length=255), nullable=True))


def downgrade() -> None:
    """Remove optional instance notes."""
    if _has_column("instances", "remark"):
        op.drop_column("instances", "remark")
