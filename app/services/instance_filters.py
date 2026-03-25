"""Shared instance filtering and normalization helpers."""

from __future__ import annotations

from urllib.parse import urlsplit, urlunsplit

from sqlalchemy import String, cast, or_

from app.models import Instance


def normalize_base_url(value: str) -> str:
    """Normalize one instance base URL for consistent storage and matching."""
    normalized = value.strip()
    if not normalized:
        return normalized

    parsed = urlsplit(normalized)
    if parsed.scheme and parsed.netloc:
        path = parsed.path.rstrip("/")
        return urlunsplit((parsed.scheme, parsed.netloc, path, "", ""))

    return normalized.rstrip("/")


def normalize_tag_filters(tags: str | list[str] | None) -> list[str]:
    """Convert one tag filter input into a normalized non-empty list."""
    if tags is None:
        return []

    if isinstance(tags, str):
        values = tags.split(",")
    else:
        values = tags

    normalized: list[str] = []
    seen: set[str] = set()

    for item in values:
        value = item.strip()
        if not value or value in seen:
            continue
        normalized.append(value)
        seen.add(value)

    return normalized


def apply_instance_filters(
    stmt,
    *,
    search: str | None = None,
    tags: str | list[str] | None = None,
    billing_mode: str | None = None,
    enabled: bool | None = None,
    health_status: str | None = None,
):
    """Apply common list and dashboard filters to an instance query."""
    normalized_tags = normalize_tag_filters(tags)

    if search:
        pattern = f"%{search.strip()}%"
        stmt = stmt.where(
            or_(
                Instance.name.ilike(pattern),
                Instance.base_url.ilike(pattern),
                Instance.username.ilike(pattern),
            )
        )

    if billing_mode:
        stmt = stmt.where(Instance.billing_mode == billing_mode)

    if enabled is not None:
        stmt = stmt.where(Instance.enabled.is_(enabled))

    if health_status:
        stmt = stmt.where(Instance.last_health_status == health_status)

    if normalized_tags:
        tag_clauses = [
            cast(Instance.tags_json, String).like(f'%"{tag}"%')
            for tag in normalized_tags
        ]
        stmt = stmt.where(or_(*tag_clauses))

    return stmt
