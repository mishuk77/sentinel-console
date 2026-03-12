from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.policy import Policy
from app.models.ml_model import MLModel, ModelStatus
from pydantic import BaseModel
from typing import List, Optional

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class PolicyCreate(BaseModel):
    model_id: str
    threshold: float
    projected_approval_rate: Optional[float] = None
    projected_loss_rate: Optional[float] = None
    target_decile: Optional[int] = None
    amount_ladder: Optional[dict] = None

    model_config = {
        "protected_namespaces": ()
    }

class PolicyResponse(BaseModel):
    id: str
    model_id: str
    threshold: float
    projected_approval_rate: Optional[float] = None
    projected_loss_rate: Optional[float] = None
    target_decile: Optional[int] = None
    amount_ladder: Optional[dict] = None
    is_active: bool

    model_config = {"protected_namespaces": (), "from_attributes": True}

class LadderRequest(BaseModel):
    dataset_id: str
    model_id: str
    threshold: float

    model_config = {"protected_namespaces": ()}

from app.api import deps
from app.models.user import User
from app.models.decision_system import DecisionSystem
from app.models.dataset import Dataset

@router.post("/recommend-amounts")
async def recommend_amounts(
    req: LadderRequest, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Generate the Loan Amount Ladder based on historical performance.
    """
    # Verify Ownership via Model -> System -> Client
    # AND Dataset -> System -> Client
    # To be safe, just verify the Model. The Model implies the system.
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == req.model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    from app.services.loan_amount import loan_amount_service
    try:
        ladder = await loan_amount_service.generate_ladder(
            db, 
            model_id=req.model_id, 
            dataset_id=req.dataset_id, 
            threshold=req.threshold
        )
        return ladder
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Ladder Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Calculation Error")

@router.post("/", response_model=PolicyResponse)
def create_policy(
    policy_in: PolicyCreate, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # Verify model exists and belongs to user
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == policy_in.model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    try:
        policy = Policy(
            model_id=policy_in.model_id,
            decision_system_id=model.decision_system_id,
            threshold=policy_in.threshold,
            projected_approval_rate=policy_in.projected_approval_rate,
            projected_loss_rate=policy_in.projected_loss_rate,
            target_decile=policy_in.target_decile,
            amount_ladder=policy_in.amount_ladder,
            is_active=False # Inactive by default
        )
        db.add(policy)
        db.commit()
        db.refresh(policy)
        return policy
    except Exception as e:
        print(f"Policy Creation Error: {e}")
        raise HTTPException(status_code=400, detail=f"Database Error: {str(e)}")

@router.get("/", response_model=List[PolicyResponse])
def list_policies(
    system_id: str = None, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    query = db.query(Policy).join(DecisionSystem).filter(
        DecisionSystem.client_id == current_user.client_id
    )
    if system_id:
        query = query.filter(Policy.decision_system_id == system_id)
    return query.all()

@router.put("/{policy_id}/activate", response_model=PolicyResponse)
def activate_policy(
    policy_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    target_policy = db.query(Policy).join(DecisionSystem).filter(
        Policy.id == policy_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not target_policy:
        raise HTTPException(status_code=404, detail="Policy not found")
        
    # Find the currently active policy (before deactivating) to migrate segments
    from app.models.policy_segment import PolicySegment
    previously_active = db.query(Policy).filter(
        Policy.decision_system_id == target_policy.decision_system_id,
        Policy.is_active == True,
        Policy.id != target_policy.id
    ).first() if target_policy.decision_system_id else None

    # Deactivate ALL policies globally (Singleton Active Policy)
    # NOW SCOPED TO SYSTEM
    if target_policy.decision_system_id:
        db.query(Policy).filter(Policy.decision_system_id == target_policy.decision_system_id).update({"is_active": False})
    else:
        # Fallback for old data?
        db.query(Policy).update({"is_active": False})

    # Migrate segments from the previously active policy to this one
    if previously_active:
        db.query(PolicySegment).filter(
            PolicySegment.policy_id == previously_active.id
        ).update({"policy_id": target_policy.id})

    # Activate target
    target_policy.is_active = True
    
    # Set this model to ACTIVE
    if target_policy.decision_system_id:
        db.query(MLModel).filter(MLModel.decision_system_id == target_policy.decision_system_id).update({"status": ModelStatus.CANDIDATE})
    else:
        db.query(MLModel).update({"status": ModelStatus.CANDIDATE}) 
    
    model = db.query(MLModel).filter(MLModel.id == target_policy.model_id).first()
    if model:
        model.status = ModelStatus.ACTIVE
        
    target_policy.is_active = True 
    db.commit()
    
    # Update DecisionSystem active pointers
    if target_policy.decision_system_id:
        ds = db.query(DecisionSystem).filter(DecisionSystem.id == target_policy.decision_system_id).first()
        if ds:
            ds.active_model_id = target_policy.model_id
            ds.active_policy_id = target_policy.id
            db.commit()
            
    db.refresh(target_policy)
    return target_policy

class ExposureUpdateRequest(BaseModel):
    decision_system_id: str
    amount_ladder: dict

@router.post("/update-exposure")
def update_exposure(
    req: ExposureUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Update the amount_ladder for the active policy of a decision system.
    """
    # Find the active policy for this system
    active_policy = db.query(Policy).join(DecisionSystem).filter(
        Policy.decision_system_id == req.decision_system_id,
        Policy.is_active == True,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not active_policy:
        raise HTTPException(status_code=404, detail="No active policy found for this system")

    # Update the amount ladder
    active_policy.amount_ladder = req.amount_ladder
    db.commit()
    db.refresh(active_policy)

    return {
        "message": "Exposure settings updated successfully",
        "policy_id": active_policy.id,
        "amount_ladder": active_policy.amount_ladder
    }

@router.delete("/{policy_id}")
def delete_policy(
    policy_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    policy = db.query(Policy).join(DecisionSystem).filter(
        Policy.id == policy_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    try:
        # Check if active?
        if policy.is_active:
             raise HTTPException(status_code=400, detail="Cannot delete an ACTIVE policy. Activate another one first.")

        db.delete(policy)
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        print(f"Delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete policy")

    return {"message": "Policy deleted"}
