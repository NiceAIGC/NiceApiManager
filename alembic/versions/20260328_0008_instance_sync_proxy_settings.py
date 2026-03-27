"""Add instance sync interval, SOCKS5 proxy, and default sync interval setting."""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0008"
down_revision = "20260325_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Extend runtime settings and instances with sync/proxy configuration."""
    op.add_column("app_settings", sa.Column("default_sync_interval_minutes", sa.Integer(), nullable=True))
    op.add_column("instances", sa.Column("socks5_proxy_url", sa.String(length=255), nullable=True))
    op.add_column(
        "instances",
        sa.Column("sync_interval_minutes", sa.Integer(), nullable=False, server_default="120"),
    )
    op.alter_column("instances", "sync_interval_minutes", server_default=None)


def downgrade() -> None:
    """Remove sync/proxy configuration columns."""
    op.drop_column("instances", "sync_interval_minutes")
    op.drop_column("instances", "socks5_proxy_url")
    op.drop_column("app_settings", "default_sync_interval_minutes")
