"""Add normalized notification center tables and migrate legacy JSON.

Revision ID: 20261116_0024
Revises: 20261103_0023
Create Date: 2026-11-16
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

from alembic import op
import sqlalchemy as sa

from app.core.crypto import decrypt_if_needed, encrypt_value


revision = "20261116_0024"
down_revision = "20261103_0023"
branch_labels = None
depends_on = None


def _load_legacy_settings(connection) -> dict[str, object]:
    row = connection.execute(
        sa.text(
            "SELECT notification_channels_json, notification_channel_groups_json, notification_rules_json "
            "FROM app_settings ORDER BY id LIMIT 1"
        )
    ).first()
    if row is None:
        return {}
    channels = _json_value(row[0])
    groups = _json_value(row[1])
    rules = _json_value(row[2])
    return {"channels": channels, "groups": groups, "rules": rules}


def _json_value(value: object) -> object:
    if value in (None, ""):
        return None
    if isinstance(value, (dict, list)):
        return value
    try:
        return json.loads(str(value))
    except (TypeError, ValueError):
        return None


def upgrade() -> None:
    """Create normalized tables and copy the legacy app_settings payload."""
    op.create_table(
        "notification_channels",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=32), nullable=False, server_default="apprise"),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("config_json", sa.JSON(), nullable=True),
        sa.Column("secrets_json", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_channel_groups",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_channel_group_members",
        sa.Column("group_id", sa.String(length=64), sa.ForeignKey("notification_channel_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("channel_id", sa.String(length=64), sa.ForeignKey("notification_channels.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "notification_contacts",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("type", sa.String(length=16), nullable=False, server_default="email"),
        sa.Column("value", sa.String(length=255), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("labels_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_contact_groups",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_contact_group_members",
        sa.Column("group_id", sa.String(length=64), sa.ForeignKey("notification_contact_groups.id", ondelete="CASCADE"), primary_key=True),
        sa.Column("contact_id", sa.String(length=64), sa.ForeignKey("notification_contacts.id", ondelete="CASCADE"), primary_key=True),
    )
    op.create_table(
        "notification_templates",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("channel_type", sa.String(length=32), nullable=False, server_default="generic"),
        sa.Column("subject_template", sa.String(length=255), nullable=True),
        sa.Column("body_template", sa.Text(), nullable=False),
        sa.Column("provider_template_code", sa.String(length=128), nullable=True),
        sa.Column("param_map_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_table(
        "notification_rules",
        sa.Column("id", sa.String(length=64), primary_key=True),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("event_type", sa.String(length=32), nullable=False),
        sa.Column("severity", sa.String(length=16), nullable=False, server_default="warning"),
        sa.Column("scope_json", sa.JSON(), nullable=True),
        sa.Column("condition_json", sa.JSON(), nullable=True),
        sa.Column("delivery_json", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False),
    )
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.add_column(sa.Column("notification_center_v2_at", sa.DateTime(timezone=True), nullable=True))

    connection = op.get_bind()
    legacy = _load_legacy_settings(connection)
    now = datetime.now(timezone.utc)

    channels = legacy.get("channels")
    if isinstance(channels, list):
        for item in channels:
            if not isinstance(item, dict):
                continue
            channel_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            if not channel_id or not name:
                continue
            if connection.execute(
                sa.text("SELECT 1 FROM notification_channels WHERE id = :id"),
                {"id": channel_id},
            ).first():
                continue
            apprise_url = decrypt_if_needed(str(item.get("apprise_url") or ""))
            secrets = encrypt_value(json.dumps({"apprise_url": apprise_url or ""}))
            connection.execute(
                sa.text(
                    "INSERT INTO notification_channels "
                    "(id, name, type, enabled, config_json, secrets_json, created_at, updated_at) "
                    "VALUES (:id, :name, :type, :enabled, :config, :secrets, :created_at, :updated_at)"
                ),
                {
                    "id": channel_id,
                    "name": name,
                    "type": str(item.get("type") or "apprise"),
                    "enabled": bool(item.get("enabled", True)),
                    "config": json.dumps(item.get("config") or {}),
                    "secrets": secrets,
                    "created_at": now,
                    "updated_at": now,
                },
            )

    groups = legacy.get("groups")
    if isinstance(groups, list):
        for item in groups:
            if not isinstance(item, dict):
                continue
            group_id = str(item.get("id") or "").strip()
            name = str(item.get("name") or "").strip()
            if not group_id or not name:
                continue
            if connection.execute(
                sa.text("SELECT 1 FROM notification_channel_groups WHERE id = :id"),
                {"id": group_id},
            ).first():
                continue
            connection.execute(
                sa.text(
                    "INSERT INTO notification_channel_groups (id, name, created_at) "
                    "VALUES (:id, :name, :created_at)"
                ),
                {"id": group_id, "name": name, "created_at": now},
            )
            for channel_id in item.get("channel_ids") or []:
                exists = connection.execute(
                    sa.text(
                        "SELECT 1 FROM notification_channel_group_members "
                        "WHERE group_id = :group_id AND channel_id = :channel_id"
                    ),
                    {"group_id": group_id, "channel_id": str(channel_id)},
                ).first()
                if exists:
                    continue
                if not connection.execute(
                    sa.text("SELECT 1 FROM notification_channels WHERE id = :id"),
                    {"id": str(channel_id)},
                ).first():
                    continue
                connection.execute(
                    sa.text(
                        "INSERT INTO notification_channel_group_members (group_id, channel_id) "
                        "VALUES (:group_id, :channel_id)"
                    ),
                    {"group_id": group_id, "channel_id": str(channel_id)},
                )

    rules = legacy.get("rules")
    if isinstance(rules, dict):
        mapping = {
            "low_balance_rules": "balance",
            "aggregate_balance_rules": "aggregate_balance",
            "connectivity_failure_rules": "connectivity",
        }
        for key, event_type in mapping.items():
            for item in rules.get(key) or []:
                if not isinstance(item, dict):
                    continue
                rule_id = str(item.get("id") or "").strip()
                name = str(item.get("name") or "").strip()
                if not rule_id or not name:
                    continue
                if connection.execute(
                    sa.text("SELECT 1 FROM notification_rules WHERE id = :id"),
                    {"id": rule_id},
                ).first():
                    continue
                scope = {
                    "instance_ids": item.get("instance_ids") or [],
                    "tags": item.get("tags") or [],
                    "include_disabled": bool(item.get("include_disabled")),
                }
                condition = {
                    "threshold": item.get("threshold"),
                    "resolve_threshold": item.get("resolve_threshold"),
                    "min_consecutive_checks": item.get("min_consecutive_checks") or 1,
                    "consecutive_failures": item.get("consecutive_failures") or 3,
                    "repeat_interval_minutes": item.get("repeat_interval_minutes") or 180,
                    "quiet_hours": item.get("quiet_hours") or {},
                }
                delivery = {
                    "channel_ids": item.get("channel_ids") or [],
                    "channel_group_ids": item.get("channel_group_ids") or [],
                    "contact_group_ids": item.get("contact_group_ids") or [],
                    "notify_on_recovery": bool(item.get("notify_on_recovery", True)),
                }
                connection.execute(
                    sa.text(
                        "INSERT INTO notification_rules "
                        "(id, name, enabled, event_type, severity, scope_json, condition_json, delivery_json, created_at, updated_at) "
                        "VALUES (:id, :name, :enabled, :event_type, :severity, :scope, :condition, :delivery, :created_at, :updated_at)"
                    ),
                    {
                        "id": rule_id,
                        "name": name,
                        "enabled": bool(item.get("enabled", True)),
                        "event_type": event_type,
                        "severity": str(item.get("severity") or "warning"),
                        "scope": json.dumps(scope),
                        "condition": json.dumps(condition),
                        "delivery": json.dumps(delivery),
                        "created_at": now,
                        "updated_at": now,
                    },
                )

    connection.execute(
        sa.text(
            "INSERT INTO app_settings (notification_center_v2_at, created_at, updated_at) "
            "SELECT :now, :now, :now WHERE NOT EXISTS (SELECT 1 FROM app_settings)"
        ),
        {"now": now},
    )
    connection.execute(
        sa.text("UPDATE app_settings SET notification_center_v2_at = :now"),
        {"now": now},
    )


def downgrade() -> None:
    """Drop normalized tables and restore the legacy JSON source of truth."""
    with op.batch_alter_table("app_settings") as batch_op:
        batch_op.drop_column("notification_center_v2_at")
    op.drop_table("notification_rules")
    op.drop_table("notification_templates")
    op.drop_table("notification_contact_group_members")
    op.drop_table("notification_contact_groups")
    op.drop_table("notification_contacts")
    op.drop_table("notification_channel_group_members")
    op.drop_table("notification_channel_groups")
    op.drop_table("notification_channels")
