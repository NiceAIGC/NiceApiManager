"""Store modern New API refresh tokens separately from legacy session cookies."""

from alembic import op
import sqlalchemy as sa


revision = "20260730_0015"
down_revision = "20260721_0014"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    if not _has_column("instance_sessions", "refresh_token"):
        op.add_column("instance_sessions", sa.Column("refresh_token", sa.Text(), nullable=True))


def downgrade() -> None:
    if _has_column("instance_sessions", "refresh_token"):
        op.drop_column("instance_sessions", "refresh_token")
