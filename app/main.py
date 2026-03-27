"""Application entrypoint for NiceApiManager."""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import FileResponse, JSONResponse, RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from sqlalchemy import update

from app.api.router import api_router
from app.core.auth import is_authenticated_request
from app.core.config import get_settings
from app.core.database import SessionLocal, prepare_database_directory
from app.core.logging import configure_logging
from app.core.scheduler import build_scheduler
from app.core.time import utcnow
from app.models import SyncRun


settings = get_settings()
configure_logging()
project_root = Path(__file__).resolve().parent.parent
frontend_dist_dir = project_root / "web" / "dist"
frontend_assets_dir = frontend_dist_dir / "assets"


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Prepare process-level resources before serving requests."""
    prepare_database_directory()
    # Convert orphaned running rows from previous crashes into a terminal state.
    with SessionLocal() as db:
        db.execute(
            update(SyncRun)
            .where(SyncRun.status == "running")
            .values(
                status="failed",
                finished_at=utcnow(),
                error_message="Service restarted before sync completed.",
            )
        )
        db.commit()
    app.state.scheduler = build_scheduler(settings)
    app.state.scheduler.start()
    try:
        yield
    finally:
        app.state.scheduler.shutdown(wait=False)


app = FastAPI(
    title=settings.app_name,
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(api_router, prefix=settings.api_v1_prefix)

if frontend_assets_dir.exists():
    app.mount("/assets", StaticFiles(directory=frontend_assets_dir), name="frontend-assets")


def _is_public_path(path: str) -> bool:
    """Return whether a request path should be accessible without authentication."""
    public_paths = {
        "/health",
        "/login",
        f"{settings.api_v1_prefix}/auth/login",
        f"{settings.api_v1_prefix}/auth/status",
        f"{settings.api_v1_prefix}/auth/logout",
    }
    return path in public_paths or path.startswith("/assets/")


@app.middleware("http")
async def require_application_auth(request: Request, call_next):
    """Protect the admin UI and JSON API behind one password-based session."""
    path = request.url.path
    if _is_public_path(path) or is_authenticated_request(request):
        return await call_next(request)

    if path.startswith(settings.api_v1_prefix):
        return JSONResponse(status_code=401, content={"detail": "Unauthorized"})

    return RedirectResponse(url="/login", status_code=302)


@app.get("/health", tags=["health"])
def healthcheck() -> dict[str, str]:
    """Simple process health probe for containers and reverse proxies."""
    return {"status": "ok"}


@app.get("/", include_in_schema=False)
@app.get("/{full_path:path}", include_in_schema=False)
async def serve_frontend(full_path: str = ""):
    """Serve the built React SPA while keeping API routes owned by FastAPI."""
    if full_path.startswith(("api/", "docs", "openapi.json", "redoc", "health", "assets/")):
        return JSONResponse(status_code=404, content={"detail": "Not Found"})

    index_file = frontend_dist_dir / "index.html"
    if not index_file.exists():
        return JSONResponse(
            status_code=503,
            content={
                "detail": "Frontend assets not found. Build the React app before serving the SPA.",
            },
        )

    return FileResponse(index_file)
