"""Helpers for normalizing and resolving SOCKS5 proxy configuration."""

from __future__ import annotations


def normalize_socks5_proxy_url(value: str | None) -> str | None:
    """Normalize optional SOCKS5 proxy input to a stable URL-like string."""
    normalized = (value or "").strip()
    if not normalized:
        return None
    if not normalized.startswith(("socks5://", "socks5h://")):
        normalized = f"socks5://{normalized}"
    return normalized


def resolve_socks5_proxy_url(
    *,
    proxy_mode: str,
    custom_proxy_url: str | None,
    shared_proxy_url: str | None,
) -> str | None:
    """Return the effective proxy URL for one instance."""
    if proxy_mode == "custom":
        return normalize_socks5_proxy_url(custom_proxy_url)
    if proxy_mode == "global":
        return normalize_socks5_proxy_url(shared_proxy_url)
    return None
