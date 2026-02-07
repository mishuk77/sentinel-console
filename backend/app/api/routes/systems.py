from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import List

from app.db.session import get_db
from app.models.decision_system import DecisionSystem
from app.schemas.decision_system import (
    DecisionSystemCreate,
    DecisionSystemUpdate,
    DecisionSystemResponse,
)

router = APIRouter(prefix="/systems", tags=["Decision Systems"])


@router.get("/", response_model=List[DecisionSystemResponse])
async def list_systems(db: AsyncSession = Depends(get_db)):
    """List all decision systems."""
    result = await db.execute(select(DecisionSystem).order_by(DecisionSystem.created_at.desc()))
    systems = result.scalars().all()
    return systems


@router.post("/", response_model=DecisionSystemResponse, status_code=status.HTTP_201_CREATED)
async def create_system(
    system_in: DecisionSystemCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new decision system."""
    system = DecisionSystem(
        name=system_in.name,
        description=system_in.description,
        enabled_modules=system_in.enabled_modules,
    )
    db.add(system)
    await db.commit()
    await db.refresh(system)
    return system


@router.get("/{system_id}", response_model=DecisionSystemResponse)
async def get_system(system_id: str, db: AsyncSession = Depends(get_db)):
    """Get a decision system by ID."""
    result = await db.execute(select(DecisionSystem).where(DecisionSystem.id == system_id))
    system = result.scalar_one_or_none()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")
    return system


@router.patch("/{system_id}", response_model=DecisionSystemResponse)
async def update_system(
    system_id: str,
    system_in: DecisionSystemUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a decision system."""
    result = await db.execute(select(DecisionSystem).where(DecisionSystem.id == system_id))
    system = result.scalar_one_or_none()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    update_data = system_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(system, field, value)

    await db.commit()
    await db.refresh(system)
    return system


@router.delete("/{system_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_system(system_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a decision system."""
    result = await db.execute(select(DecisionSystem).where(DecisionSystem.id == system_id))
    system = result.scalar_one_or_none()
    if not system:
        raise HTTPException(status_code=404, detail="System not found")

    await db.delete(system)
    await db.commit()
    return None
