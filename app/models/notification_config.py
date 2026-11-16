"""Normalized notification configuration models.

The legacy configuration lived in a single JSON blob on ``app_settings``. These
tables make channels, recipients, templates and rules independently editable,
auditable and encryptable while the runtime adapter keeps the existing alert
evaluators working during migration.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import Boolean, DateTime, ForeignKey, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.core.crypto import EncryptedText
from app.core.time import utcnow
from app.models.base import Base


class NotificationChannel(Base):
    """One outbound delivery channel (Apprise, SMTP, Aliyun, webhook)."""

    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    type: Mapped[str] = mapped_column(String(32), nullable=False, default="apprise")
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    config_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    # Whole secret payload is encrypted at rest; values are never returned raw.
    secrets_json: Mapped[str | None] = mapped_column(EncryptedText, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class NotificationChannelGroup(Base):
    """Named bundle of channels selectable as one delivery target."""

    __tablename__ = "notification_channel_groups"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class NotificationChannelGroupMember(Base):
    """Membership row for a channel group."""

    __tablename__ = "notification_channel_group_members"

    group_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("notification_channel_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    channel_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("notification_channels.id", ondelete="CASCADE"),
        primary_key=True,
    )


class NotificationContact(Base):
    """A person or endpoint that can receive email/SMS/chat messages."""

    __tablename__ = "notification_contacts"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    type: Mapped[str] = mapped_column(String(16), nullable=False, default="email")
    value: Mapped[str] = mapped_column(String(255), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    labels_json: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class NotificationContactGroup(Base):
    """Named bundle of contacts (for example an on-call rotation)."""

    __tablename__ = "notification_contact_groups"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)


class NotificationContactGroupMember(Base):
    """Membership row for a contact group."""

    __tablename__ = "notification_contact_group_members"

    group_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("notification_contact_groups.id", ondelete="CASCADE"),
        primary_key=True,
    )
    contact_id: Mapped[str] = mapped_column(
        String(64),
        ForeignKey("notification_contacts.id", ondelete="CASCADE"),
        primary_key=True,
    )


class NotificationTemplate(Base):
    """Reusable message template for a channel family."""

    __tablename__ = "notification_templates"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    channel_type: Mapped[str] = mapped_column(String(32), nullable=False, default="generic")
    subject_template: Mapped[str | None] = mapped_column(String(255), nullable=True)
    body_template: Mapped[str] = mapped_column(Text, nullable=False)
    provider_template_code: Mapped[str | None] = mapped_column(String(128), nullable=True)
    param_map_json: Mapped[dict[str, str] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )


class NotificationRule(Base):
    """Normalized alert rule consumed by the notification engine."""

    __tablename__ = "notification_rules"

    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    name: Mapped[str] = mapped_column(String(80), nullable=False)
    enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    event_type: Mapped[str] = mapped_column(String(32), nullable=False)
    severity: Mapped[str] = mapped_column(String(16), nullable=False, default="warning")
    scope_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    condition_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    delivery_json: Mapped[dict[str, Any] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        default=utcnow,
        onupdate=utcnow,
        nullable=False,
    )
