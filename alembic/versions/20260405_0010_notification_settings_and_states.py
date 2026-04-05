"""Add notification settings and persisted rule states."""

from alembic import op
import sqlalchemy as sa


revision = "20260405_0010"
down_revision = "20260328_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Extend app settings with notification config and add rule-state storage."""
    op.add_column("app_settings", sa.Column("notification_enabled", sa.Boolean(), nullable=True))
    op.add_column("app_settings", sa.Column("notification_check_interval_minutes", sa.Integer(), nullable=True))
    op.add_column("app_settings", sa.Column("notification_channels_json", sa.JSON(), nullable=True))
    op.add_column("app_settings", sa.Column("notification_rules_json", sa.JSON(), nullable=True))
    op.add_column("app_settings", sa.Column("notification_last_scan_at", sa.DateTime(timezone=True), nullable=True))

    op.create_table(
        "notification_rule_states",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("rule_type", sa.String(length=32), nullable=False),
        sa.Column("rule_id", sa.String(length=64), nullable=False),
        sa.Column("target_key", sa.String(length=128), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("consecutive_hits", sa.Integer(), nullable=False),
        sa.Column("last_value", sa.String(length=255), nullable=True),
        sa.Column("last_triggered_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_resolved_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_evaluated_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("rule_type", "rule_id", "target_key", name="uq_notification_rule_state"),
    )
    op.create_index(op.f("ix_notification_rule_states_rule_id"), "notification_rule_states", ["rule_id"], unique=False)
    op.create_index(
        op.f("ix_notification_rule_states_rule_type"),
        "notification_rule_states",
        ["rule_type"],
        unique=False,
    )


def downgrade() -> None:
    """Remove notification config columns and rule-state storage."""
    op.drop_index(op.f("ix_notification_rule_states_rule_type"), table_name="notification_rule_states")
    op.drop_index(op.f("ix_notification_rule_states_rule_id"), table_name="notification_rule_states")
    op.drop_table("notification_rule_states")

    op.drop_column("app_settings", "notification_last_scan_at")
    op.drop_column("app_settings", "notification_rules_json")
    op.drop_column("app_settings", "notification_channels_json")
    op.drop_column("app_settings", "notification_check_interval_minutes")
    op.drop_column("app_settings", "notification_enabled")
