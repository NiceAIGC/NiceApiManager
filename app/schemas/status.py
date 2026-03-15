"""System status response schemas."""

from pydantic import BaseModel


class SystemStatusResponse(BaseModel):
    """Runtime status exposed by the management backend."""

    status: str
    instance_count: int
