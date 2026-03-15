"""Initial schema for NiceApiManager."""

from alembic import op
import sqlalchemy as sa


revision = "20260315_0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create all tables required by the first backend version."""
    op.create_table(
        "instances",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("base_url", sa.String(length=255), nullable=False),
        sa.Column("username", sa.String(length=100), nullable=False),
        sa.Column("password", sa.Text(), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("last_sync_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_health_status", sa.String(length=32), nullable=False, server_default="unknown"),
        sa.Column("last_health_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_instances")),
        sa.UniqueConstraint("name", name=op.f("uq_instances_name")),
    )
    op.create_index(op.f("ix_instances_name"), "instances", ["name"], unique=False)

    op.create_table(
        "instance_sessions",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("remote_user_id", sa.Integer(), nullable=False),
        sa.Column("cookie_value", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["instances.id"],
            name=op.f("fk_instance_sessions_instance_id_instances"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_instance_sessions")),
        sa.UniqueConstraint("instance_id", name=op.f("uq_instance_sessions_instance_id")),
    )

    op.create_table(
        "user_snapshots",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("quota", sa.BigInteger(), nullable=False),
        sa.Column("used_quota", sa.BigInteger(), nullable=False),
        sa.Column("request_count", sa.Integer(), nullable=False),
        sa.Column("group_name", sa.String(length=100), nullable=True),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["instances.id"],
            name=op.f("fk_user_snapshots_instance_id_instances"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_user_snapshots")),
    )
    op.create_index(op.f("ix_user_snapshots_instance_id"), "user_snapshots", ["instance_id"], unique=False)
    op.create_index(op.f("ix_user_snapshots_snapshot_at"), "user_snapshots", ["snapshot_at"], unique=False)

    op.create_table(
        "group_ratios",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("group_name", sa.String(length=100), nullable=False),
        sa.Column("group_desc", sa.String(length=255), nullable=True),
        sa.Column("ratio", sa.Float(), nullable=False),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["instances.id"],
            name=op.f("fk_group_ratios_instance_id_instances"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_group_ratios")),
        sa.UniqueConstraint("instance_id", "group_name", name=op.f("uq_group_ratios_instance_id")),
    )
    op.create_index(op.f("ix_group_ratios_instance_id"), "group_ratios", ["instance_id"], unique=False)
    op.create_index(op.f("ix_group_ratios_snapshot_at"), "group_ratios", ["snapshot_at"], unique=False)

    op.create_table(
        "pricing_models",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("model_name", sa.String(length=255), nullable=False),
        sa.Column("vendor_id", sa.Integer(), nullable=True),
        sa.Column("vendor_name", sa.String(length=100), nullable=True),
        sa.Column("quota_type", sa.Integer(), nullable=False),
        sa.Column("model_ratio", sa.Float(), nullable=False),
        sa.Column("model_price", sa.Float(), nullable=False),
        sa.Column("completion_ratio", sa.Float(), nullable=False),
        sa.Column("enable_groups_json", sa.JSON(), nullable=True),
        sa.Column("supported_endpoint_types_json", sa.JSON(), nullable=True),
        sa.Column("snapshot_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["instances.id"],
            name=op.f("fk_pricing_models_instance_id_instances"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_pricing_models")),
        sa.UniqueConstraint("instance_id", "model_name", name=op.f("uq_pricing_models_instance_id")),
    )
    op.create_index(op.f("ix_pricing_models_instance_id"), "pricing_models", ["instance_id"], unique=False)
    op.create_index(op.f("ix_pricing_models_model_name"), "pricing_models", ["model_name"], unique=False)
    op.create_index(op.f("ix_pricing_models_snapshot_at"), "pricing_models", ["snapshot_at"], unique=False)

    op.create_table(
        "sync_runs",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("instance_id", sa.Integer(), nullable=False),
        sa.Column("trigger_type", sa.String(length=32), nullable=False),
        sa.Column("status", sa.String(length=32), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("finished_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("duration_ms", sa.Integer(), nullable=True),
        sa.Column("error_message", sa.Text(), nullable=True),
        sa.Column("summary_json", sa.JSON(), nullable=True),
        sa.ForeignKeyConstraint(
            ["instance_id"],
            ["instances.id"],
            name=op.f("fk_sync_runs_instance_id_instances"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_sync_runs")),
    )
    op.create_index(op.f("ix_sync_runs_instance_id"), "sync_runs", ["instance_id"], unique=False)
    op.create_index(op.f("ix_sync_runs_started_at"), "sync_runs", ["started_at"], unique=False)


def downgrade() -> None:
    """Drop all tables in reverse dependency order."""
    op.drop_index(op.f("ix_sync_runs_started_at"), table_name="sync_runs")
    op.drop_index(op.f("ix_sync_runs_instance_id"), table_name="sync_runs")
    op.drop_table("sync_runs")

    op.drop_index(op.f("ix_pricing_models_snapshot_at"), table_name="pricing_models")
    op.drop_index(op.f("ix_pricing_models_model_name"), table_name="pricing_models")
    op.drop_index(op.f("ix_pricing_models_instance_id"), table_name="pricing_models")
    op.drop_table("pricing_models")

    op.drop_index(op.f("ix_group_ratios_snapshot_at"), table_name="group_ratios")
    op.drop_index(op.f("ix_group_ratios_instance_id"), table_name="group_ratios")
    op.drop_table("group_ratios")

    op.drop_index(op.f("ix_user_snapshots_snapshot_at"), table_name="user_snapshots")
    op.drop_index(op.f("ix_user_snapshots_instance_id"), table_name="user_snapshots")
    op.drop_table("user_snapshots")

    op.drop_table("instance_sessions")

    op.drop_index(op.f("ix_instances_name"), table_name="instances")
    op.drop_table("instances")
