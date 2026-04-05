"""Notification history schemas."""

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class NotificationLogChannelResult(BaseModel):
    """Per-channel delivery snapshot stored inside one notification log."""

    channel_id: str
    channel_name: str
    success: bool
    error_message: str | None = None


class NotificationLogResponse(BaseModel):
    """Public view of one notification event."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    instance_id: int | None = None
    instance_name: str | None = None
    rule_type: str | None = None
    rule_id: str | None = None
    rule_name: str | None = None
    event_type: str
    source_type: str
    target_key: str | None = None
    title: str
    body: str | None = None
    notify_type: str
    delivery_status: str
    channels_json: list[dict[str, Any]] | None = None
    error_message: str | None = None
    created_at: datetime


class NotificationLogListResponse(BaseModel):
    """List wrapper for notification history."""

    total: int
    offset: int
    limit: int
    items: list[NotificationLogResponse]
