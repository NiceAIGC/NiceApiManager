"""Shared fuzzy-search helpers for list endpoints.

"aa BB" matches "AA123BB" and "Aa bb": each token is split into characters
and joined with `%`, so any substring of the original token in the right
order is a hit. This is intentionally wide — the user expects broad search.
"""

from __future__ import annotations


def fuzzy_like_pattern(value: str | None) -> str | None:
    """Build a wide LIKE pattern from a search keyword.

    Each whitespace-separated token is expanded character by character with
    `%` separators, so "aa bb" becomes `%a%a%b%b%` and matches "AA123BB".
    Returns None when the keyword is empty.
    """
    if not value:
        return None
    tokens = [part for part in value.strip().split() if part]
    if not tokens:
        return None
    # Each token becomes "%a%a"; tokens share the middle wildcard.
    return "%" + "%".join("%".join(token.lower()) for token in tokens) + "%"
