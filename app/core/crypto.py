"""AES-GCM at-rest encryption for sensitive fields.

Ciphertexts carry an ``enc:v1:`` prefix so legacy plaintext rows keep working
until the startup migration rewrites them. The key comes from the
``NAM_SECRET_KEY`` environment variable, falling back to a SHA-256 derivation
of the configured ``auth_secret_key``.
"""

from __future__ import annotations

import base64
import hashlib
import logging
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from sqlalchemy.types import Text, TypeDecorator

from app.core.config import get_settings


logger = logging.getLogger(__name__)

ENCRYPTED_PREFIX = "enc:v1:"
_NONCE_BYTES = 12
_cached_key: bytes | None = None


def _key() -> bytes:
    """Return the cached 32-byte AES key derived from the configured secret."""
    global _cached_key
    if _cached_key is None:
        secret = os.environ.get("NAM_SECRET_KEY") or get_settings().auth_secret_key
        if not secret or secret == "change-this-secret-key":
            logger.warning("敏感字段加密正在使用默认密钥派生，请配置 NAM_SECRET_KEY 或 AUTH_SECRET_KEY。")
        _cached_key = hashlib.sha256(secret.encode("utf-8")).digest()
    return _cached_key


def encrypt_value(value: str | None) -> str | None:
    """Encrypt one string; None/empty/already-encrypted values pass through."""
    if not value or value.startswith(ENCRYPTED_PREFIX):
        return value
    nonce = os.urandom(_NONCE_BYTES)
    ciphertext = AESGCM(_key()).encrypt(nonce, value.encode("utf-8"), None)
    return ENCRYPTED_PREFIX + base64.urlsafe_b64encode(nonce + ciphertext).decode("ascii")


def decrypt_if_needed(value: str | None) -> str | None:
    """Decrypt when the value carries the encrypted prefix; otherwise return as-is."""
    if not value or not value.startswith(ENCRYPTED_PREFIX):
        return value
    try:
        raw = base64.urlsafe_b64decode(value[len(ENCRYPTED_PREFIX):].encode("ascii"))
        nonce, ciphertext = raw[:_NONCE_BYTES], raw[_NONCE_BYTES:]
        return AESGCM(_key()).decrypt(nonce, ciphertext, None).decode("utf-8")
    except Exception as exc:  # pragma: no cover - corrupted or wrong key
        logger.error("敏感字段解密失败（密钥可能已更换）: %s", exc)
        return value


class EncryptedText(TypeDecorator[str]):
    """Text column that transparently encrypts on write and decrypts on read."""

    impl = Text
    cache_ok = True

    def process_bind_param(self, value: str | None, dialect) -> str | None:  # noqa: ARG002
        """Encrypt plaintext values before they hit the database."""
        return encrypt_value(value)

    def process_result_value(self, value: str | None, dialect) -> str | None:  # noqa: ARG002
        """Decrypt values coming back from the database."""
        return decrypt_if_needed(value)
