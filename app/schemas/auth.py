"""Authentication request and response schemas."""

from pydantic import BaseModel


class LoginRequest(BaseModel):
    """Password login payload."""

    password: str


class AuthStatusResponse(BaseModel):
    """Current authentication status for the frontend."""

    authenticated: bool
    session_days: int
