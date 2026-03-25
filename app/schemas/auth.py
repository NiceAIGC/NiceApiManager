"""Authentication request and response schemas."""

from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    """Password login payload."""

    password: str


class AuthStatusResponse(BaseModel):
    """Current authentication status for the frontend."""

    authenticated: bool
    session_days: int


class ChangePasswordRequest(BaseModel):
    """Payload used to change the admin password."""

    current_password: str
    new_password: str = Field(min_length=6)
