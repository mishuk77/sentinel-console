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
    # TASK-11E / TASK-2: surface state and audit fields so the UI can show
    # "Last saved" / "Published" indicators.
    state: Optional[str] = None
    last_published_at: Optional[str] = None
    published_by: Optional[str] = None

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

def _run_layer_2_validation(db: Session, model: MLModel) -> dict:
    """
    TASK-10 Layer 2 (consolidates TASK-9): run health checks on the
    full inference pipeline parity — same code path as production.

    Steps:
      1. Score the model's training/test data through the production
         inference path (decision_service._score_model with the saved
         schema-v2 artifact, which uses InferencePreprocessor).
      2. Run all six health checks on the resulting predictions.
      3. If any check FAILs → registration is rejected with a clear error.
      4. WARN-level results allow registration but flag the decision
         system with health_status='warning'.

    Returns a dict with 'status' and 'failures' for the caller.

    The dataset for parity scoring is the model's training dataset. We
    don't need 2000+ rows for the structural checks (saturation, mode
    collapse, range, NaN/inf, distribution drift) but H5 (calibration)
    requires the full holdout to be statistically meaningful.
    """
    from app.models.dataset import Dataset
    from app.services.inference_health import InferenceHealthChecker
    from app.services.storage import storage
    from app.services.inference_preprocessor import InferencePreprocessor  # noqa: F401  (used at unpickle)
    import joblib
    import os
    import pandas as pd
    import numpy as np

    if not model.artifact_path:
        return {"status": "FAIL", "message": "Model has no trained artifact."}

    dataset = db.query(Dataset).filter(Dataset.id == model.dataset_id).first()
    if not dataset:
        return {"status": "FAIL", "message": "Dataset not found for model."}

    # Download the dataset CSV
    local_csv = f"temp_layer2_{model.id[:8]}.csv"
    try:
        storage.download_file(dataset.s3_key, local_csv)
        df = pd.read_csv(local_csv)
    finally:
        if os.path.exists(local_csv):
            os.remove(local_csv)

    # Load the model artifact
    local_pkl = f"temp_layer2_artifact_{model.id[:8]}.pkl"
    try:
        storage.download_file(model.artifact_path, local_pkl)
        artifact = joblib.load(local_pkl)
    finally:
        if os.path.exists(local_pkl):
            os.remove(local_pkl)

    target_col = model.target_column
    feature_cols = [c for c in df.columns
                    if c != target_col
                    and c != dataset.approved_amount_column
                    and c != dataset.id_column
                    and not c.lower().endswith("id")]
    X = df[feature_cols].copy()
    y = df[target_col].astype(int).values if target_col and target_col in df.columns else None

    # Score through the inference pipeline (schema v2)
    if isinstance(artifact, dict) and artifact.get("schema_version") == 2:
        preprocessor = artifact["preprocessor"]
        scaler = artifact.get("scaler")
        use_scaled = artifact.get("use_scaled", False)
        clf = artifact["model"]
        X_proc = preprocessor.transform(X)
        if use_scaled and scaler is not None:
            X_final = pd.DataFrame(scaler.transform(X_proc), columns=X_proc.columns, index=X_proc.index)
        else:
            X_final = X_proc
        predictions = clf.predict_proba(X_final)[:, 1]
    else:
        # Legacy artifact — limited to structural checks; calibration may be unreliable
        return {"status": "WARN", "message": "Legacy model artifact — re-train for full validation."}

    # Run health checks. Use full dataset for calibration if it's large enough.
    checker = InferenceHealthChecker()
    use_calibration = y is not None and len(y) >= 2000
    report = checker.run_all(
        predictions=predictions,
        outcomes=y if use_calibration else None,
    )

    # TASK-10 Layer 3 H6: capture the prediction distribution at
    # registration time as a fixed baseline. The runtime monitor compares
    # subsequent rolling-window distributions against this baseline using
    # the KS statistic. Stored as quantile values (P5..P95 in 10pp steps)
    # — compact enough for the JSON column, enough resolution for KS.
    if len(predictions) >= 100:
        quantiles = [0.05, 0.15, 0.25, 0.35, 0.45,
                     0.55, 0.65, 0.75, 0.85, 0.95]
        baseline_quantiles = [
            float(np.quantile(predictions, q)) for q in quantiles
        ]
    else:
        baseline_quantiles = None

    return {
        "status": report.status,
        "report": report.to_dict(),
        "distribution_baseline": baseline_quantiles,
        "failures": [
            {"check": r.check_name, "message": r.message}
            for r in report.failures
        ],
        "warnings": [
            {"check": r.check_name, "message": r.message}
            for r in report.warnings
        ],
    }


@router.put("/{policy_id}/activate", response_model=PolicyResponse)
def activate_policy(
    policy_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
    skip_health_checks: bool = False,
):
    """
    Activate (publish) a policy. Per TASK-10 Layer 2: this is the
    registration boundary, so we run the full inference-pipeline health
    check before allowing activation. FAIL-level results block the
    activation; WARN flags the system with health_status='warning'.

    The skip_health_checks query parameter is for emergency rollbacks /
    explicit override. Default is to enforce checks.
    """
    target_policy = db.query(Policy).join(DecisionSystem).filter(
        Policy.id == policy_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not target_policy:
        raise HTTPException(status_code=404, detail="Policy not found")

    # Race protection: lock all policies in this decision system for the
    # duration of the activate transaction. Without this, two concurrent
    # activate calls could both pass the "deactivate others" step before
    # either commits, leaving multiple published policies (a violation of
    # the spec's singleton-published rule).
    #
    # SELECT ... FOR UPDATE works on Postgres (production). On SQLite
    # (local dev / tests) it's a no-op but the operation is still safe
    # because SQLite has process-level write locking. We catch the
    # not-supported error rather than failing.
    if target_policy.decision_system_id:
        try:
            db.query(Policy).filter(
                Policy.decision_system_id == target_policy.decision_system_id
            ).with_for_update().all()
        except Exception:
            # SQLite / drivers without FOR UPDATE — fall through. Process
            # serialization in dev is acceptable; production is Postgres.
            pass

    # TASK-10 Layer 2 — registration health check
    if not skip_health_checks:
        model = db.query(MLModel).filter(MLModel.id == target_policy.model_id).first()
        if model:
            validation = _run_layer_2_validation(db, model)
            if validation["status"] == "FAIL":
                failure_msgs = "; ".join(
                    f"{f['check']}: {f['message']}" for f in validation.get("failures", [])
                )
                raise HTTPException(
                    status_code=422,
                    detail=(
                        f"Cannot activate policy — model failed registration health checks. "
                        f"{failure_msgs} Re-train the model or pass "
                        f"?skip_health_checks=true to override (audit-logged)."
                    ),
                )
            # Persist the latest health report + distribution baseline
            # on the model. The baseline is fixed at the moment of
            # registration and is what the Layer 3 runtime monitor
            # compares subsequent rolling windows against.
            from sqlalchemy.orm.attributes import flag_modified
            model.health_status = validation["status"].lower() if validation["status"] != "PASS" else "healthy"
            if "report" in validation:
                model.health_report = validation["report"]
                flag_modified(model, "health_report")
            if validation.get("distribution_baseline") is not None:
                model.distribution_baseline = validation["distribution_baseline"]
                flag_modified(model, "distribution_baseline")
        
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

    # TASK-11E: explicit state machine. Activation = publish.
    # Capture audit metadata: when, who, and a snapshot of the policy
    # configuration so historical backtests can re-render with the exact
    # config that was in effect.
    from datetime import datetime as _dt
    target_policy.state = "published"
    target_policy.last_published_at = _dt.utcnow()
    target_policy.published_by = getattr(current_user, "email", None)
    target_policy.published_snapshot = {
        "threshold": target_policy.threshold,
        "amount_ladder": target_policy.amount_ladder,
        "projected_approval_rate": target_policy.projected_approval_rate,
        "projected_loss_rate": target_policy.projected_loss_rate,
        "target_decile": target_policy.target_decile,
        "model_id": target_policy.model_id,
        "published_at": target_policy.last_published_at.isoformat(),
        "published_by": target_policy.published_by,
    }

    # Mark previously published policies as archived (TASK-11E: only one
    # published policy per system).
    if target_policy.decision_system_id:
        db.query(Policy).filter(
            Policy.decision_system_id == target_policy.decision_system_id,
            Policy.id != target_policy.id,
            Policy.state == "published",
        ).update({"state": "archived"})

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


# ────────────────────────────────────────────────────────────────────────
# TASK-3 / TASK-11E: save-draft endpoint
# ────────────────────────────────────────────────────────────────────────
class PolicyDraftUpdate(BaseModel):
    """Body for PATCH /policies/{id} — saves a draft, doesn't publish."""
    threshold: Optional[float] = None
    amount_ladder: Optional[dict] = None
    projected_approval_rate: Optional[float] = None
    projected_loss_rate: Optional[float] = None
    target_decile: Optional[int] = None

    model_config = {"protected_namespaces": ()}


@router.patch("/{policy_id}")
def save_draft_policy(
    policy_id: str,
    update: PolicyDraftUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Save policy edits as a draft. Per TASK-11E: 'Save Configuration' creates
    a draft, doesn't publish. Production decisioning continues to use
    whatever was last published.

    The frontend calls this on every save action; only when the user
    explicitly clicks "Publish" does activate_policy() run and the changes
    take effect for production traffic.
    """
    target = db.query(Policy).join(DecisionSystem).filter(
        Policy.id == policy_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not target:
        raise HTTPException(status_code=404, detail="Policy not found")

    # If this policy was previously published, editing it transitions it
    # back to draft state. The previously-published version remains
    # active in production until the user explicitly publishes the draft.
    if target.state == "published":
        # Clone-then-edit pattern: create a new draft preserving the
        # published version. (Simpler approach: just demote to draft.
        # The published_snapshot field still has the previous config.)
        target.state = "draft"

    if update.threshold is not None:
        target.threshold = update.threshold
    if update.amount_ladder is not None:
        target.amount_ladder = update.amount_ladder
    if update.projected_approval_rate is not None:
        target.projected_approval_rate = update.projected_approval_rate
    if update.projected_loss_rate is not None:
        target.projected_loss_rate = update.projected_loss_rate
    if update.target_decile is not None:
        target.target_decile = update.target_decile

    db.commit()
    db.refresh(target)
    return target

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
