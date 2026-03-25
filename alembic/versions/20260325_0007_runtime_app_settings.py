"""Add runtime sync and network settings to app_settings."""

from alembic import op
import sqlalchemy as sa


revision = "20260325_0007"
down_revision = "20260325_0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Extend the singleton app settings table with runtime configuration columns."""
    op.add_column("app_settings", sa.Column("sync_max_workers", sa.Integer(), nullable=True))
    op.add_column("app_settings", sa.Column("request_timeout", sa.Float(), nullable=True))
    op.add_column("app_settings", sa.Column("sync_verify_ssl", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("scheduler_timezone", sa.String(length=64), nullable=True))
    op.add_column("app_settings", sa.Column("sync_history_lookback_days", sa.Integer(), nullable=True))


def downgrade() -> None:
    """Remove runtime configuration columns from the app settings table."""
    op.drop_column("app_settings", "sync_history_lookback_days")
    op.drop_column("app_settings", "scheduler_timezone")
    op.drop_column("app_settings", "sync_verify_ssl")
    op.drop_column("app_settings", "request_timeout")
    op.drop_column("app_settings", "sync_max_workers")
