"""Add instance sync interval, SOCKS5 proxy, and default sync interval setting."""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0008"
down_revision = "20260325_0007"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    """Return whether the current database already contains the target column."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Extend runtime settings and instances with sync/proxy configuration."""
    if not _has_column("app_settings", "default_sync_interval_minutes"):
        op.add_column("app_settings", sa.Column("default_sync_interval_minutes", sa.Integer(), nullable=True))

    if not _has_column("instances", "socks5_proxy_url"):
        op.add_column("instances", sa.Column("socks5_proxy_url", sa.String(length=255), nullable=True))

    if not _has_column("instances", "sync_interval_minutes"):
        op.add_column(
            "instances",
            sa.Column("sync_interval_minutes", sa.Integer(), nullable=False, server_default="120"),
        )

    op.execute(sa.text("UPDATE instances SET sync_interval_minutes = 120 WHERE sync_interval_minutes IS NULL"))


def downgrade() -> None:
    """Remove sync/proxy configuration columns."""
    if _has_column("instances", "sync_interval_minutes"):
        op.drop_column("instances", "sync_interval_minutes")
    if _has_column("instances", "socks5_proxy_url"):
        op.drop_column("instances", "socks5_proxy_url")
    if _has_column("app_settings", "default_sync_interval_minutes"):
        op.drop_column("app_settings", "default_sync_interval_minutes")
