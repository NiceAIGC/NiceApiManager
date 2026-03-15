"""Logging setup."""

import logging


def configure_logging() -> None:
    """Apply a minimal but readable log format for local and container execution."""
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
    )

