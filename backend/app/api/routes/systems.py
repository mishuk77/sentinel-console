from typing import Any, List, Optional
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import SessionLocal

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

from app.models.decision_system import DecisionSystem
from pydantic import BaseModel
from datetime import datetime

router = APIRouter()

class DecisionSystemCreate(BaseModel):
    name: str
    description: Optional[str] = None
    system_type: Optional[str] = "full"  # "credit" | "fraud" | "full"

class DecisionSystemOut(BaseModel):
    id: str
    name: str
    description: Optional[str] = None
    system_type: Optional[str] = "full"
    created_at: datetime

    active_model_id: Optional[str] = None
    active_policy_id: Optional[str] = None

    # Active Model/Policy info could be computed or fetched
    active_model_summary: Optional[dict] = None
    active_policy_summary: Optional[dict] = None

    class Config:
        from_attributes = True

from app.api import deps
from app.models.user import User

@router.get("/", response_model=List[DecisionSystemOut])
def list_systems(
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    systems = db.query(DecisionSystem).filter(
        DecisionSystem.client_id == current_user.client_id
    ).order_by(DecisionSystem.created_at.desc()).all()
    return systems

@router.post("/", response_model=DecisionSystemOut)
def create_system(
    system_in: DecisionSystemCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # Validate system_type
    valid_types = ("credit", "fraud", "full")
    st = system_in.system_type or "full"
    if st not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid system_type. Must be one of: {valid_types}")

    system = DecisionSystem(
        name=system_in.name,
        description=system_in.description,
        system_type=st,
        client_id=current_user.client_id # Strict ownership assignment
    )
    db.add(system)
    db.commit()
    db.refresh(system)
    return system

@router.get("/{system_id}", response_model=DecisionSystemOut)
def get_system(
    system_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # Strict Isolation Check
    system = db.query(DecisionSystem).filter(
        DecisionSystem.id == system_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not system:
        raise HTTPException(status_code=404, detail="Decision System not found")
    
    # Manually construct to avoid from_orm surprises
    resp = DecisionSystemOut(
        id=system.id,
        name=system.name,
        description=system.description,
        system_type=system.system_type or "full",
        created_at=system.created_at,
        active_model_id=system.active_model_id,
        active_policy_id=system.active_policy_id
    )

    from app.models.ml_model import MLModel
    from app.models.policy import Policy
    
    if system.active_model_id:
        model = db.query(MLModel).filter(MLModel.id == system.active_model_id).first()
        if model:
            # Use default dict for safety if metrics is None
            metrics = model.metrics or {}
            resp.active_model_summary = {
                "id": model.id,
                "name": model.name,
                "algorithm": model.algorithm,
                "auc": metrics.get("auc", 0)
            }
            
    if system.active_policy_id:
        policy = db.query(Policy).filter(Policy.id == system.active_policy_id).first()
        if policy:
                resp.active_policy_summary = {
                "name": f"Active Policy ({policy.target_decile * 10}% Target)" if policy.target_decile else "Active Policy",
                "threshold": policy.threshold,
                "approval_rate": policy.projected_approval_rate,
                "target_decile": policy.target_decile
            }
    return resp

@router.delete("/{system_id}")
def delete_system(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    system = db.query(DecisionSystem).filter(
        DecisionSystem.id == system_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not system:
        raise HTTPException(status_code=404, detail="Decision System not found")
        
    try:
        # Delete child records that lack ondelete CASCADE
        from app.models.ml_model import MLModel
        from app.models.dataset import Dataset
        from app.models.decision import Decision
        from app.models.policy import Policy
        db.query(MLModel).filter(MLModel.decision_system_id == system_id).delete()
        db.query(Dataset).filter(Dataset.decision_system_id == system_id).delete()
        db.query(Decision).filter(Decision.decision_system_id == system_id).delete()
        db.query(Policy).filter(Policy.decision_system_id == system_id).delete()
        db.delete(system)
        db.commit()
    except Exception as e:
        db.rollback()
        print(f"Delete failed: {e}")
        import traceback
        traceback.print_exc()
        raise HTTPException(status_code=500, detail="Failed to delete system")
        
    return {"message": "System deleted"}

@router.post("/{system_id}/upgrade")
def upgrade_system_type(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """One-way upgrade: credit -> full, fraud -> full."""
    system = db.query(DecisionSystem).filter(
        DecisionSystem.id == system_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    if not system:
        raise HTTPException(status_code=404, detail="Decision System not found")
    if (system.system_type or "full") == "full":
        raise HTTPException(status_code=400, detail="System is already Full Pipeline")
    system.system_type = "full"
    db.commit()
    return {"message": "System upgraded to Full Pipeline", "system_type": "full"}
