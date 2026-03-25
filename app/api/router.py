"""Top-level API router."""

from fastapi import APIRouter

from app.api.routes import auth, dashboard, groups, instances, pricing, settings, sync, sync_runs


api_router = APIRouter()
api_router.include_router(auth.router, tags=["auth"])
api_router.include_router(instances.router, tags=["instances"])
api_router.include_router(sync.router, tags=["sync"])
api_router.include_router(dashboard.router, tags=["dashboard"])
api_router.include_router(groups.router, tags=["groups"])
api_router.include_router(pricing.router, tags=["pricing"])
api_router.include_router(sync_runs.router, tags=["sync-runs"])
api_router.include_router(settings.router, tags=["settings"])
