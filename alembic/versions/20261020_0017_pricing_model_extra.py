"""Add source-specific extra metadata to pricing models."""

from alembic import op
import sqlalchemy as sa


revision = "20261020_0017"
down_revision = "20261020_0016"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("pricing_models", "extra_json"):
        op.add_column("pricing_models", sa.Column("extra_json", sa.JSON(), nullable=True))


def downgrade() -> None:
    if _has_column("pricing_models", "extra_json"):
        op.drop_column("pricing_models", "extra_json")
