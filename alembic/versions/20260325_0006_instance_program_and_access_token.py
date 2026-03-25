"""Add instance program type and access-token authentication fields."""

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision = "20260325_0006"
down_revision = "20260325_0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Persist upstream program type and token-based auth configuration."""
    bind = op.get_bind()
    inspector = inspect(bind)
    instance_columns = {column["name"] for column in inspector.get_columns("instances")}
    session_columns = {column["name"] for column in inspector.get_columns("instance_sessions")}

    if "program_type" not in instance_columns:
        op.add_column(
            "instances",
            sa.Column("program_type", sa.String(length=16), nullable=False, server_default="newapi"),
        )
    if "remote_user_id" not in instance_columns:
        op.add_column("instances", sa.Column("remote_user_id", sa.Integer(), nullable=True))
    if "access_token" not in instance_columns:
        op.add_column("instances", sa.Column("access_token", sa.Text(), nullable=True))
    if "access_token" not in session_columns:
        op.add_column("instance_sessions", sa.Column("access_token", sa.Text(), nullable=True))

    op.execute("UPDATE instances SET program_type = 'newapi' WHERE program_type IS NULL")


def downgrade() -> None:
    """Drop instance program metadata and access-token auth fields."""
    op.drop_column("instance_sessions", "access_token")
    op.drop_column("instances", "access_token")
    op.drop_column("instances", "remote_user_id")
    op.drop_column("instances", "program_type")
