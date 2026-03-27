"""Add shared proxy, proxy mode, and instance priority settings."""

from alembic import op
import sqlalchemy as sa


revision = "20260328_0009"
down_revision = "20260328_0008"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    """Return whether the current database already contains the target column."""
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def upgrade() -> None:
    """Extend settings and instances with shared proxy and priority metadata."""
    if not _has_column("app_settings", "shared_socks5_proxy_url"):
        op.add_column("app_settings", sa.Column("shared_socks5_proxy_url", sa.String(length=255), nullable=True))

    if not _has_column("instances", "proxy_mode"):
        op.add_column(
            "instances",
            sa.Column("proxy_mode", sa.String(length=16), nullable=False, server_default="direct"),
        )

    if not _has_column("instances", "priority"):
        op.add_column(
            "instances",
            sa.Column("priority", sa.Integer(), nullable=False, server_default="3"),
        )

    op.execute(
        sa.text(
            "UPDATE instances SET proxy_mode = 'custom' "
            "WHERE socks5_proxy_url IS NOT NULL AND TRIM(socks5_proxy_url) <> ''",
        )
    )
    op.execute(sa.text("UPDATE instances SET priority = 3 WHERE priority IS NULL"))


def downgrade() -> None:
    """Remove shared proxy and instance priority settings."""
    if _has_column("instances", "priority"):
        op.drop_column("instances", "priority")
    if _has_column("instances", "proxy_mode"):
        op.drop_column("instances", "proxy_mode")
    if _has_column("app_settings", "shared_socks5_proxy_url"):
        op.drop_column("app_settings", "shared_socks5_proxy_url")
