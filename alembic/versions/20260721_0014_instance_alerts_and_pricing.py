"""Add instance quick alerts, disable provenance, and richer pricing fields."""

from alembic import op
import sqlalchemy as sa


revision = "20260721_0014"
down_revision = "20260406_0013"
branch_labels = None
depends_on = None


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _add_column(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def upgrade() -> None:
    _add_column("app_settings", sa.Column("default_balance_alert_threshold", sa.Float(), nullable=True))
    _add_column("app_settings", sa.Column("default_notification_channel_id", sa.String(length=64), nullable=True))

    _add_column(
        "instances",
        sa.Column("auto_disabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    _add_column(
        "instances",
        sa.Column("balance_alert_enabled", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    _add_column("instances", sa.Column("balance_alert_threshold", sa.Float(), nullable=True))
    _add_column("instances", sa.Column("notification_channel_ids_json", sa.JSON(), nullable=True))

    _add_column("pricing_models", sa.Column("cache_ratio", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("create_cache_ratio", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("billing_mode", sa.String(length=32), nullable=True))


def downgrade() -> None:
    columns = {
        "pricing_models": ("billing_mode", "create_cache_ratio", "cache_ratio"),
        "instances": (
            "notification_channel_ids_json",
            "balance_alert_threshold",
            "balance_alert_enabled",
            "auto_disabled",
        ),
        "app_settings": ("default_notification_channel_id", "default_balance_alert_threshold"),
    }
    for table_name, column_names in columns.items():
        for column_name in column_names:
            if _has_column(table_name, column_name):
                op.drop_column(table_name, column_name)
