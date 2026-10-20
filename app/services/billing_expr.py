"""Best-effort parser for NewAPI `tiered_expr` billing expressions.

Upstream expressions (see new-api `pkg/billingexpr/expr.md`) look like:

    len <= 272000 ? tier("standard", p * 10 + c * 50 + cr * 1 + cc * 12.5)
                  : tier("long_context", p * 20 + c * 75 + cr * 2 + cc * 25)

    weekday("Asia/Shanghai") >= 1 && ... ? tier("peak", ...) : tier("off_peak", ...)

    tier("request", fixed(0.00075))

Token coefficients are real USD-per-1M-token prices, so parsed tiers can be
stored/displayed directly without ratio conversion. The parser is intentionally
tolerant: anything it cannot structure is preserved as raw text.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any

_TIER_CALL_RE = re.compile(r'tier\s*\(\s*["\']([^"\']+)["\']\s*,')
_FIXED_RE = re.compile(r"fixed\s*\(\s*([0-9]+(?:\.[0-9]+)?)\s*\)")
# `2.5 * p`, `p * 2.5`, `2.5*p` — coefficient may also be an integer.
_COEF_RE = re.compile(
    r"(?:(?P<left>[0-9]*\.?[0-9]+)\s*\*\s*(?P<var_left>[A-Za-z_][A-Za-z0-9_]*))"
    r"|(?:(?P<var_right>[A-Za-z_][A-Za-z0-9_]*)\s*\*\s*(?P<right>[0-9]*\.?[0-9]+))"
)
_TIER_CONDITION_RE = re.compile(
    r"^\s*(?P<var>p|c|len)\s*(?P<op><=|>=|<|>)\s*(?P<value>[0-9]+(?:\.[0-9]+)?)\s*$"
)
_HOUR_WINDOW_RE = re.compile(
    r'hour\s*\(\s*["\'](?P<tz>[^"\']+)["\']\s*\)\s*>=\s*(?P<from>\d{1,2})\s*&&\s*'
    r'hour\s*\(\s*["\'][^"\']+["\']\s*\)\s*<\s*(?P<to>\d{1,2})'
)
_HOUR_WINDOW_CLOSED_RE = re.compile(
    r'hour\s*\(\s*["\'](?P<tz>[^"\']+)["\']\s*\)\s*>\s*(?P<from>\d{1,2})\s*&&\s*'
    r'hour\s*\(\s*["\'][^"\']+["\']\s*\)\s*<=\s*(?P<to>\d{1,2})'
)
_WEEKDAY_RANGE_RE = re.compile(
    r'weekday\s*\(\s*["\'](?P<tz>[^"\']+)["\']\s*\)\s*>=\s*(?P<from>\d{1})\s*&&\s*'
    r'weekday\s*\(\s*["\'][^"\']+["\']\s*\)\s*<=\s*(?P<to>\d{1})'
)

# Variables whose coefficient is a USD-per-1M-token price.
_PRICE_VARS = ("p", "c", "cr", "cc", "cc1h", "img", "img_cr", "img_o", "ai", "ao")
_PRICE_VAR_LABELS = {
    "p": "input",
    "c": "output",
    "cr": "cache_read",
    "cc": "cache_write",
    "cc1h": "cache_write_1h",
    "img": "image_input",
    "img_cr": "image_cache_read",
    "img_o": "image_output",
    "ai": "audio_input",
    "ao": "audio_output",
}


@dataclass
class ParsedTier:
    """One structured `tier(...)` leaf with the conditions leading to it."""

    label: str
    conditions: list[dict[str, Any]] = field(default_factory=list)
    # Raw time-based condition text (e.g. DeepSeek peak windows), if any.
    time_condition: str | None = None
    # Structured best-effort hour windows: [{timezone, from_hour, to_hour}]
    time_windows: list[dict[str, Any]] = field(default_factory=list)
    weekdays_only: bool = False
    fixed_price: float | None = None
    # USD per 1M tokens keyed by input/output/cache_read/cache_write/...
    prices: dict[str, float] = field(default_factory=dict)
    raw: str = ""


def parse_billing_expr(expression: str | None) -> dict[str, Any] | None:
    """Parse a tiered_expr string into structured tiers, or None if unusable."""
    if not expression or not expression.strip():
        return None

    text = expression.strip()
    if text.startswith("v1:"):
        text = text[3:].strip()
    request_rules = ""
    if "|||" in text:
        text, _, request_rules = text.partition("|||")
        text = text.strip()

    tiers: list[ParsedTier] = []
    _collect_tiers(text, [], tiers)

    if not tiers:
        return None

    result_tiers: list[dict[str, Any]] = []
    for tier in tiers:
        result_tiers.append(
            {
                "label": tier.label,
                "conditions": tier.conditions,
                "time_condition": tier.time_condition,
                "time_windows": tier.time_windows,
                "weekdays_only": tier.weekdays_only,
                "fixed_price": tier.fixed_price,
                "prices": tier.prices,
                "raw": tier.raw,
            }
        )

    parsed: dict[str, Any] = {
        "tiers": result_tiers,
        "tier_count": len(result_tiers),
    }
    rule_text = request_rules.strip()
    if rule_text:
        parsed["request_rules"] = rule_text
    return parsed


def parse_request_rule_periods(request_rules: str | None) -> list[dict[str, Any]]:
    """Extract hour windows from appended request-rule multipliers, if any."""
    if not request_rules:
        return []
    windows = _extract_time_windows(request_rules)
    return [
        {"timezone": tz, "from_hour": from_hour, "to_hour": to_hour, "weekdays_only": weekday_only}
        for tz, from_hour, to_hour, weekday_only in windows
    ] or []


def _collect_tiers(text: str, path_conditions: list[dict[str, Any]], tiers: list[ParsedTier]) -> None:
    """Walk ternary branches and emit one ParsedTier per `tier(...)` leaf."""
    branches, conditions = _split_ternary(text)
    if branches is None:
        leaf = _parse_leaf(text.strip(), path_conditions)
        if leaf is not None:
            tiers.append(leaf)
        return

    structured = [_structure_condition(condition) for condition in conditions]
    true_path = [*path_conditions, *structured]
    false_path = [*path_conditions, *(_invert_condition(item) for item in structured)]
    _collect_tiers(branches[0], true_path, tiers)
    _collect_tiers(branches[1], false_path, tiers)


_INVERTED_OPS = {"<": ">=", "<=": ">", ">": "<=", ">=": "<"}

def _structure_condition(condition: str) -> dict[str, Any]:
    """Classify one conjunction part into tier/time/raw condition shapes."""
    stripped = condition.strip()
    tier_match = _TIER_CONDITION_RE.match(stripped)
    if tier_match:
        return {
            "kind": "tier",
            "var": tier_match.group("var"),
            "op": tier_match.group("op"),
            "value": float(tier_match.group("value")),
        }
    if "hour(" in stripped or "weekday(" in stripped or "minute(" in stripped:
        return {"kind": "time", "text": stripped}
    return {"kind": "raw", "text": stripped}


def _invert_condition(condition: dict[str, Any]) -> dict[str, Any]:
    """Invert one condition for the false branch of a ternary."""
    if condition.get("kind") == "tier" and condition.get("op") in _INVERTED_OPS:
        inverted = dict(condition)
        inverted["op"] = _INVERTED_OPS[condition["op"]]
        return inverted
    if condition.get("kind") == "raw" and "text" in condition:
        return {"kind": "raw", "text": f'!({condition["text"]})'}
    if condition.get("kind") == "time" and "text" in condition:
        return {"kind": "time", "text": f'!({condition["text"]})'}
    return condition


def _parse_leaf(text: str, conditions: list[dict[str, Any]]) -> ParsedTier | None:
    match = _TIER_CALL_RE.search(text)
    if match is None:
        return None

    label = match.group(1)
    body = text[match.end() :].rstrip()
    if body.endswith(")"):
        body = body[:-1]

    tier = ParsedTier(label=label, raw=text)
    time_parts: list[str] = []
    for condition in conditions:
        kind = condition.get("kind")
        if kind == "tier":
            tier.conditions.append(
                {"var": condition["var"], "op": condition["op"], "value": condition["value"]}
            )

        elif kind == "time" and not condition["text"].startswith("!("):
            time_parts.append(condition["text"])
        elif kind == "time":
            # Negated time condition (ternary false branch): windows would be
            # misleading, keep the raw text only.
            tier.conditions.append({"raw": condition["text"]})
    if time_parts:
        # Join every time-related part so window/weekday regexes see the whole
        # condition (splitting at `&&` would break `weekday >= 1 && weekday <= 5`).
        joined = " && ".join(time_parts)
        tier.time_condition = joined
        for tz, from_hour, to_hour, weekday_only in _extract_time_windows(joined):
            tier.time_windows.append(
                {"timezone": tz, "from_hour": from_hour, "to_hour": to_hour}
            )
            tier.weekdays_only = tier.weekdays_only or weekday_only

    fixed_match = _FIXED_RE.search(body)
    if fixed_match:
        tier.fixed_price = float(fixed_match.group(1))
        return tier

    for coef_match in _COEF_RE.finditer(body):
        if coef_match.group("var_left"):
            var_name = coef_match.group("var_left")
            coefficient = float(coef_match.group("left"))
        else:
            var_name = coef_match.group("var_right")
            coefficient = float(coef_match.group("right"))
        if var_name in _PRICE_VARS:
            price_key = _PRICE_VAR_LABELS[var_name]
            tier.prices[price_key] = coefficient
        elif var_name not in ("n",):
            # Unknown priced variable (e.g. future token classes) — keep raw text.
            tier.conditions.append({"raw": f"{var_name}={coefficient}"})

    return tier


def _split_ternary(text: str) -> tuple[list[str] | None, list[str]]:
    """Split the first top-level ternary into (branches, conditions).

    Handles chained ternaries (`c1 ? a : c2 ? b : d`) the same way expr-lang
    does: right-associative, so the true branch never contains a top-level
    `?`/`:` and the false branch may hold the remaining chain.
    Returns `(None, [])` when the text is not a ternary expression.
    """
    question_index = _find_top_level_char(text, "?")
    if question_index is None:
        return None, []

    colon_index = _find_top_level_char(text, ":", start=question_index + 1)
    if colon_index is None:
        return None, []

    branches = [
        text[question_index + 1 : colon_index].strip(),
        text[colon_index + 1 :].strip(),
    ]
    if not all(branches):
        return None, []

    conditions = _split_conjunction(text[:question_index])
    return branches, conditions


def _find_top_level_char(text: str, target: str, start: int = 0) -> int | None:
    """Return the index of the first top-level occurrence of `target`."""
    depth = 0
    in_string: str | None = None
    for i in range(start, len(text)):
        char = text[i]
        if in_string:
            if char == in_string:
                in_string = None
            continue
        if char in "\"'":
            in_string = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == target and depth == 0:
            return i
    return None


def _split_conjunction(text: str) -> list[str]:
    """Split `a && b` at top-level `&&` boundaries."""
    parts: list[str] = []
    depth = 0
    in_string: str | None = None
    start = 0
    i = 0
    while i < len(text):
        char = text[i]
        if in_string:
            if char == in_string:
                in_string = None
            i += 1
            continue
        if char in "\"'":
            in_string = char
        elif char in "([{":
            depth += 1
        elif char in ")]}":
            depth -= 1
        elif char == "&" and depth == 0 and text[i : i + 2] == "&&":
            parts.append(text[start:i].strip())
            i += 2
            start = i
            continue
        i += 1
    parts.append(text[start:].strip())
    return [part for part in parts if part]


def _extract_time_windows(condition: str) -> list[tuple[str, int, int, bool]]:
    """Extract (timezone, from_hour, to_hour, weekdays_only) hour windows."""
    windows: list[tuple[str, int, int, bool]] = []
    seen: set[tuple[str, int, int, bool]] = set()

    weekday_only = False
    for weekday_match in _WEEKDAY_RANGE_RE.finditer(condition):
        if int(weekday_match.group("from")) == 1 and int(weekday_match.group("to")) == 5:
            weekday_only = True

    patterns = (_HOUR_WINDOW_RE, _HOUR_WINDOW_CLOSED_RE)
    for pattern in patterns:
        for match in pattern.finditer(condition):
            tz = match.group("tz")
            from_hour = int(match.group("from"))
            to_hour = int(match.group("to"))
            entry = (tz, from_hour, to_hour, weekday_only)
            if entry not in seen:
                seen.add(entry)
                windows.append(entry)
    return windows
