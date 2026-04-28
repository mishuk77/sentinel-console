from fastapi import APIRouter
from app.api.routes import (
    datasets, models, decision, dashboard, policies, systems, auth, fraud,
    policy_segments, simulation,
)

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(systems.router, prefix="/systems", tags=["systems"])
api_router.include_router(datasets.router, prefix="/datasets", tags=["datasets"])
api_router.include_router(models.router, prefix="/models", tags=["models"])
api_router.include_router(policies.router, prefix="/policies", tags=["policies"])
api_router.include_router(policy_segments.router, prefix="/policies", tags=["segments"])
api_router.include_router(decision.router, prefix="/decisions", tags=["decisions"])
api_router.include_router(dashboard.router, prefix="/dashboard", tags=["dashboard"])

# TASK-3 / TASK-2 / TASK-7: portfolio simulation endpoint
api_router.include_router(simulation.router, prefix="/simulate", tags=["simulation"])

# Fraud Management Module
api_router.include_router(fraud.router, tags=["fraud"])
