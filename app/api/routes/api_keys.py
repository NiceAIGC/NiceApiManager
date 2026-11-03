"""Admin routes for managing external API keys."""

from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.api_keys import create_api_key
from app.models import ApiKey

router = APIRouter()


class ApiKeyCreateRequest(BaseModel):
    """Payload for issuing one API key."""

    name: str = Field(min_length=1, max_length=80)


class ApiKeyToggleRequest(BaseModel):
    """Payload for enabling or disabling one API key."""

    enabled: bool


def _serialize(record: ApiKey) -> dict[str, object]:
    """Serialize one API key without exposing its hash."""
    return {
        "id": record.id,
        "name": record.name,
        "key_prefix": record.key_prefix,
        "enabled": record.enabled,
        "created_at": record.created_at.isoformat() if record.created_at else None,
        "last_used_at": record.last_used_at.isoformat() if record.last_used_at else None,
    }


@router.get("/docs.md", response_class=PlainTextResponse)
def get_api_docs() -> str:
    """Serve the Markdown API documentation bundled with the app."""
    for candidate in (
        Path(__file__).resolve().parents[3] / "docs" / "api.md",
        Path(__file__).resolve().parents[2] / "docs" / "api.md",
        Path.cwd() / "docs" / "api.md",
        Path.cwd().parent / "docs" / "api.md",
    ):
        if candidate.exists():
            return candidate.read_text(encoding="utf-8")
    return "# API 文档缺失\n\n未找到 docs/api.md。"


@router.get("/api-keys")
def list_api_keys(db: Session = Depends(get_db)) -> dict[str, object]:
    """List all issued API keys (plaintext is never shown again)."""
    records = db.scalars(select(ApiKey).order_by(ApiKey.created_at.desc())).all()
    return {"items": [_serialize(record) for record in records]}


@router.post("/api-keys", status_code=201)
def create_api_key_route(payload: ApiKeyCreateRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    """Issue one API key; the full key is returned only in this response."""
    record, plaintext = create_api_key(db, payload.name)
    return {**_serialize(record), "key": plaintext}


@router.patch("/api-keys/{key_id}")
def toggle_api_key(key_id: int, payload: ApiKeyToggleRequest, db: Session = Depends(get_db)) -> dict[str, object]:
    """Enable or disable one API key."""
    record = db.get(ApiKey, key_id)
    if record is None:
        raise HTTPException(status_code=404, detail="API key not found.")
    record.enabled = payload.enabled
    db.commit()
    return _serialize(record)


@router.delete("/api-keys/{key_id}")
def delete_api_key(key_id: int, db: Session = Depends(get_db)) -> dict[str, bool]:
    """Revoke one API key permanently."""
    record = db.get(ApiKey, key_id)
    if record is None:
        raise HTTPException(status_code=404, detail="API key not found.")
    db.delete(record)
    db.commit()
    return {"ok": True}
