"""Add daily usage stats for 30-day history backfill."""

from alembic import op
import sqlalchemy as sa


revision = "20260325_0005"
down_revision = "20260325_0004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the daily usage stats table used by charts and daily request metrics."""
    op.create_table(
        "daily_usage_stats",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("usage_date", sa.Date(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("used_quota", sa.BigInteger(), nullable=False),
        sa.Column("used_display_amount", sa.Float(), nullable=False),
        sa.Column("synced_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["instance_id"], ["instances.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_daily_usage_stats")),
        sa.UniqueConstraint("instance_id", "usage_date", name="uq_daily_usage_stats_instance_date"),
    )
    op.create_index(op.f("ix_daily_usage_stats_instance_id"), "daily_usage_stats", ["instance_id"], unique=False)
    op.create_index(op.f("ix_daily_usage_stats_usage_date"), "daily_usage_stats", ["usage_date"], unique=False)


def downgrade() -> None:
    """Drop the daily usage stats table."""
    op.drop_index(op.f("ix_daily_usage_stats_usage_date"), table_name="daily_usage_stats")
    op.drop_index(op.f("ix_daily_usage_stats_instance_id"), table_name="daily_usage_stats")
    op.drop_table("daily_usage_stats")
