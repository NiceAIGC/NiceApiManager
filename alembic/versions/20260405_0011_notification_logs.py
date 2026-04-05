"""Add notification logs table."""

from alembic import op
import sqlalchemy as sa


revision = "20260405_0011"
down_revision = "20260405_0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create notification delivery history table."""
    op.create_table(
        "notification_logs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=True),
        sa.Column("rule_type", sa.String(length=32), nullable=True),
        sa.Column("rule_id", sa.String(length=64), nullable=True),
        sa.Column("rule_name", sa.String(length=128), nullable=True),
        sa.Column("event_type", sa.String(length=24), nullable=False),
        sa.Column("source_type", sa.String(length=24), nullable=False),
        sa.Column("target_key", sa.String(length=128), nullable=True),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("notify_type", sa.String(length=24), nullable=False),
        sa.Column("delivery_status", sa.String(length=24), nullable=False),
        sa.Column("channels_json", sa.JSON(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["instance_id"], ["instances.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_notification_logs_created_at"), "notification_logs", ["created_at"], unique=False)
    op.create_index(op.f("ix_notification_logs_instance_id"), "notification_logs", ["instance_id"], unique=False)


def downgrade() -> None:
    """Drop notification delivery history table."""
    op.drop_index(op.f("ix_notification_logs_instance_id"), table_name="notification_logs")
    op.drop_index(op.f("ix_notification_logs_created_at"), table_name="notification_logs")
    op.drop_table("notification_logs")
