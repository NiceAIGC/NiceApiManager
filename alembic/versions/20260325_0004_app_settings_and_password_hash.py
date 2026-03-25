"""Add app settings table for mutable admin password."""

from alembic import op
import sqlalchemy as sa


revision = "20260325_0004"
down_revision = "20260324_0003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the singleton settings table used for runtime password changes."""
    op.create_table(
        "app_settings",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("auth_password_hash", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_app_settings")),
    )


def downgrade() -> None:
    """Drop the app settings table."""
    op.drop_table("app_settings")
