"""Richer pricing/group storage, group labels, and Sub2API micro-USD quotas.

- pricing_models: billing_expr, parsed tiers, time pricing, normalized
  USD-per-1M-token prices.
- group_ratios: platform, user ratio, peak window, extra JSON.
- New tables group_labels / group_label_assignments.
- Sub2API instances previously stored USD amounts as integer quota units with
  quota_per_unit = 1, losing cents. Re-scale to micro-USD (quota_per_unit =
  1_000_000) for exact balances; historical snapshots and daily usage are
  multiplied accordingly.
"""

from alembic import op
import sqlalchemy as sa


revision = "20261020_0016"
down_revision = "20260730_0015"
branch_labels = None
depends_on = None

MICRO_USD_PER_UNIT = 1_000_000.0


def _has_column(table_name: str, column_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return column_name in {column["name"] for column in inspector.get_columns(table_name)}


def _has_table(table_name: str) -> bool:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    return table_name in inspector.get_table_names()


def _add_column(table_name: str, column: sa.Column) -> None:
    if not _has_column(table_name, column.name):
        op.add_column(table_name, column)


def _rescale_sub2api_quota(factor: float) -> None:
    """Multiply stored Sub2API quota counters by `factor` (1e6 up, 1e-6 down)."""
    instances = sa.table(
        "instances",
        sa.column("id", sa.Integer),
        sa.column("program_type", sa.String),
        sa.column("quota_per_unit", sa.Float),
    )
    bind = op.get_bind()
    sub2api_ids = [
        row.id
        for row in bind.execute(
            sa.select(instances.c.id).where(instances.c.program_type == "sub2api")
        )
    ]
    if not sub2api_ids:
        return

    for instance_id in sub2api_ids:
        quota_per_unit = bind.execute(
            sa.select(instances.c.quota_per_unit).where(instances.c.id == instance_id)
        ).scalar()
        # Only rows stored under the legacy USD (1.0) or unset unit need scaling.
        if quota_per_unit is None:
            bind.execute(
                instances.update()
                .where(instances.c.id == instance_id)
                .values(quota_per_unit=MICRO_USD_PER_UNIT)
            )
            continue
        if abs(float(quota_per_unit) - 1.0) > 1e-9:
            continue
        bind.execute(
            instances.update()
            .where(instances.c.id == instance_id)
            .values(quota_per_unit=MICRO_USD_PER_UNIT)
        )
        bind.execute(
            sa.text(
                "UPDATE user_snapshots SET quota = CAST(ROUND(quota * :factor) AS INTEGER),"
                " used_quota = CAST(ROUND(used_quota * :factor) AS INTEGER)"
                " WHERE instance_id = :instance_id"
            ),
            {"factor": factor, "instance_id": instance_id},
        )
        bind.execute(
            sa.text(
                "UPDATE daily_usage_stats SET used_quota = CAST(ROUND(used_quota * :factor) AS INTEGER)"
                " WHERE instance_id = :instance_id"
            ),
            {"factor": factor, "instance_id": instance_id},
        )


def upgrade() -> None:
    _add_column("pricing_models", sa.Column("billing_expr", sa.Text(), nullable=True))
    _add_column("pricing_models", sa.Column("tiers_json", sa.JSON(), nullable=True))
    _add_column("pricing_models", sa.Column("time_pricing_json", sa.JSON(), nullable=True))
    _add_column("pricing_models", sa.Column("price_input", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("price_output", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("price_cache_read", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("price_cache_write", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("price_cache_write_1h", sa.Float(), nullable=True))
    _add_column("pricing_models", sa.Column("price_per_request", sa.Float(), nullable=True))

    _add_column("group_ratios", sa.Column("platform", sa.String(length=64), nullable=True))
    _add_column("group_ratios", sa.Column("user_ratio", sa.Float(), nullable=True))
    _add_column("group_ratios", sa.Column("peak_ratio", sa.Float(), nullable=True))
    _add_column("group_ratios", sa.Column("peak_start", sa.String(length=16), nullable=True))
    _add_column("group_ratios", sa.Column("peak_end", sa.String(length=16), nullable=True))
    _add_column("group_ratios", sa.Column("extra_json", sa.JSON(), nullable=True))

    if not _has_table("group_labels"):
        op.create_table(
            "group_labels",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("color", sa.String(length=32), nullable=True),
            sa.Column("remark", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        )
        op.create_index("ix_group_labels_name", "group_labels", ["name"], unique=True)

    if not _has_table("group_label_assignments"):
        op.create_table(
            "group_label_assignments",
            sa.Column("id", sa.Integer(), primary_key=True),
            sa.Column(
                "label_id",
                sa.Integer(),
                sa.ForeignKey("group_labels.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("group_name", sa.String(length=100), nullable=False),
            sa.Column("enabled", sa.Boolean(), nullable=False),
            sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
            # Inline constraint: SQLite cannot ALTER TABLE ADD CONSTRAINT.
            sa.UniqueConstraint("label_id", "group_name", name="uq_group_label_assignments_label_group"),
        )
        op.create_index("ix_group_label_assignments_label_id", "group_label_assignments", ["label_id"])
        op.create_index("ix_group_label_assignments_group_name", "group_label_assignments", ["group_name"])
        # Inline constraint: SQLite cannot ALTER TABLE ADD CONSTRAINT.
        # (Already declared inline in create_table above when freshly created.)

    _rescale_sub2api_quota(MICRO_USD_PER_UNIT)


def downgrade() -> None:
    _rescale_sub2api_quota(1.0 / MICRO_USD_PER_UNIT)

    pricing_columns = (
        "price_per_request",
        "price_cache_write_1h",
        "price_cache_write",
        "price_cache_read",
        "price_output",
        "price_input",
        "time_pricing_json",
        "tiers_json",
        "billing_expr",
    )
    group_columns = (
        "extra_json",
        "peak_end",
        "peak_start",
        "peak_ratio",
        "user_ratio",
        "platform",
    )
    for column_name in pricing_columns:
        if _has_column("pricing_models", column_name):
            op.drop_column("pricing_models", column_name)
    for column_name in group_columns:
        if _has_column("group_ratios", column_name):
            op.drop_column("group_ratios", column_name)

    if _has_table("group_label_assignments"):
        op.drop_table("group_label_assignments")
    if _has_table("group_labels"):
        op.drop_table("group_labels")
