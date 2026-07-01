"""Add default instance proxy mode setting."""

from alembic import op
import sqlalchemy as sa


revision = "20260406_0012"
down_revision = "20260405_0011"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    """Return whether the current database already contains the target column."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Persist the default proxy mode used by newly created instances."""
    if not _has_column("app_settings", "default_instance_proxy_mode"):
        op.add_column(
            "app_settings",
            sa.Column("default_instance_proxy_mode", sa.String(length=16), nullable=True),
        )


def downgrade() -> None:
    """Remove the default instance proxy mode setting."""
    if _has_column("app_settings", "default_instance_proxy_mode"):
        op.drop_column("app_settings", "default_instance_proxy_mode")
