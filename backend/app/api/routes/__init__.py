from fastapi import APIRouter

from app.api.routes import systems, auth, datasets

api_router = APIRouter()

api_router.include_router(auth.router)
api_router.include_router(systems.router)
api_router.include_router(datasets.router)
