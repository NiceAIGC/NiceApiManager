"""Simple admin authentication routes."""

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_db
from app.core.auth import (
    AUTH_COOKIE_NAME,
    create_session_token,
    is_authenticated_request,
    update_password,
    verify_password,
)
from app.core.config import get_settings
from app.schemas.auth import AuthStatusResponse, ChangePasswordRequest, LoginRequest


router = APIRouter()


@router.get("/auth/status", response_model=AuthStatusResponse)
def get_auth_status(request: Request) -> AuthStatusResponse:
    """Return whether the current browser session is authenticated."""
    settings = get_settings()
    return AuthStatusResponse(
        authenticated=is_authenticated_request(request),
        session_days=settings.auth_session_days,
    )


@router.post("/auth/login", response_model=AuthStatusResponse)
def login(
    payload: LoginRequest,
    response: Response,
    db: Session = Depends(get_db),
) -> AuthStatusResponse:
    """Validate the configured password and issue a long-lived session cookie."""
    settings = get_settings()
    if not verify_password(db, payload.password):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="密码错误。")

    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=create_session_token(),
        max_age=settings.auth_session_days * 24 * 60 * 60,
        httponly=True,
        samesite="lax",
        secure=settings.app_env != "development",
        path="/",
    )
    return AuthStatusResponse(authenticated=True, session_days=settings.auth_session_days)


@router.post("/auth/logout", response_model=AuthStatusResponse)
def logout(response: Response) -> AuthStatusResponse:
    """Clear the current session cookie."""
    settings = get_settings()
    response.delete_cookie(key=AUTH_COOKIE_NAME, path="/")
    return AuthStatusResponse(authenticated=False, session_days=settings.auth_session_days)


@router.post("/auth/change-password", response_model=AuthStatusResponse)
def change_password(
    payload: ChangePasswordRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AuthStatusResponse:
    """Allow the current authenticated admin to change the login password."""
    settings = get_settings()

    if not is_authenticated_request(request):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="未登录或登录已失效。")

    if not verify_password(db, payload.current_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="当前密码错误。")

    update_password(db, payload.new_password)
    return AuthStatusResponse(authenticated=True, session_days=settings.auth_session_days)
