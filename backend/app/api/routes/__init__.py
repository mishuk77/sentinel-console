from fastapi import APIRouter

from app.api.routes import systems

api_router = APIRouter()

api_router.include_router(systems.router)
