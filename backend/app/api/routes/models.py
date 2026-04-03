from typing import List, Optional
from fastapi import APIRouter, Depends, BackgroundTasks, HTTPException
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.dataset import Dataset
from app.models.ml_model import MLModel, ModelStatus
from app.services.training import training_service
import uuid

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

import logging
logger = logging.getLogger("sentinel.training")

def train_task(dataset_id: str, model_map: dict, target_col: str, feature_cols: List[str], model_context: str = "credit"):
    logger.info(f"[TRAIN] Background task started for dataset={dataset_id}, models={model_map}")
    db = SessionLocal()
    try:
        dataset = db.query(Dataset).filter(Dataset.id == dataset_id).first()
        if not dataset:
            logger.error(f"[TRAIN] Dataset {dataset_id} not found in background task")
            return

        logger.info(f"[TRAIN] Dataset found: s3_key={dataset.s3_key}, target={target_col}, context={model_context}")

        try:
            results = training_service.train_models(dataset.s3_key, target_col, feature_cols, model_context)
            logger.info(f"[TRAIN] Training complete. {len(results)} results.")

            for res in results:
                algo_name = res['name']
                if algo_name in model_map:
                    model_id = model_map[algo_name]
                    model = db.query(MLModel).filter(MLModel.id == model_id).first()
                    if model:
                        model.status = ModelStatus.CANDIDATE
                        model.metrics = res['metrics']
                        from sqlalchemy.orm.attributes import flag_modified
                        flag_modified(model, "metrics")
                        model.artifact_path = res['artifact_path']
                        model.name = f"{algo_name}_{model_id[:8]}"

            db.commit()
            logger.info("[TRAIN] Models updated in DB.")

        except Exception as e:
            import traceback
            logger.error(f"[TRAIN] Training failed: {e}")
            logger.error(traceback.format_exc())
            for mid in model_map.values():
                model = db.query(MLModel).filter(MLModel.id == mid).first()
                if model:
                    model.status = ModelStatus.FAILED
            db.commit()

    except Exception as e:
        import traceback
        logger.error(f"[TRAIN] Outer exception: {e}")
        logger.error(traceback.format_exc())
    finally:
        db.close()


from typing import List, Optional
from pydantic import BaseModel

class TrainRequest(BaseModel):
    target_col: Optional[str] = "charge_off" # Default for backward compatibility
    feature_cols: Optional[List[str]] = None
    model_context: Optional[str] = "credit"  # "credit" or "fraud"

from app.api import deps
from app.models.user import User
from app.models.decision_system import DecisionSystem

@router.post("/{dataset_id}/train")
async def train_dataset(
    dataset_id: str, 
    train_req: TrainRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    # Verify Dataset Ownership via System
    dataset = db.query(Dataset).join(DecisionSystem).filter(
        Dataset.id == dataset_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")
        
    # Pre-create models in TRAINING state
    algos = ["logistic_regression", "random_forest", "xgboost"]
    model_map = {}
    
    for algo in algos:
        new_model = MLModel(
            dataset_id=dataset_id,
            decision_system_id=dataset.decision_system_id,
            algorithm=algo,
            status=ModelStatus.TRAINING,
            name=f"{algo}_pending"
        )
        db.add(new_model)
        db.flush() # get ID
        model_map[algo] = new_model.id
        
    db.commit()
        
    print(f"[TRAIN] Queuing background task for dataset={dataset_id}, models={model_map}")
    background_tasks.add_task(train_task, dataset_id, model_map, train_req.target_col, train_req.feature_cols, train_req.model_context or "credit")
    return {"message": "Training started", "models": model_map}

@router.get("/")
def list_models(
    system_id: str = None, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    query = db.query(MLModel).join(DecisionSystem).filter(
        DecisionSystem.client_id == current_user.client_id
    )
    if system_id:
        query = query.filter(MLModel.decision_system_id == system_id)
    return query.order_by(MLModel.created_at.desc()).all()

@router.get("/{model_id}")
def get_model(
    model_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    return model

@router.post("/{model_id}/activate")
def activate_model(
    model_id: str, 
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
        
    # Determine model context (credit vs fraud)
    model_context = (model.metrics or {}).get("model_context", "credit")

    # Only deactivate models of the same context
    active_same_context = db.query(MLModel).filter(
        MLModel.decision_system_id == model.decision_system_id,
        MLModel.status == ModelStatus.ACTIVE
    ).all()

    for m in active_same_context:
        m_context = (m.metrics or {}).get("model_context", "credit")
        if m_context == model_context and m.id != model.id:
            m.status = ModelStatus.CANDIDATE

    model.status = ModelStatus.ACTIVE
    db.commit()

    # Update DecisionSystem active pointers
    if model.decision_system_id:
        ds = db.query(DecisionSystem).filter(DecisionSystem.id == model.decision_system_id).first()
        if ds:
            if model_context == "fraud":
                ds.active_fraud_model_id = model.id
            else:
                ds.active_model_id = model.id
                from app.models.policy import Policy
                if ds.active_policy_id:
                    current_policy = db.query(Policy).filter(Policy.id == ds.active_policy_id).first()
                    if current_policy and current_policy.model_id != model.id:
                        ds.active_policy_id = None # Clear outdated policy

            db.commit()
            
    db.refresh(model)
    return {"message": "Model activated", "model": model}

@router.get("/{model_id}/documentation")
def get_model_documentation(
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    from fastapi.responses import StreamingResponse
    from datetime import datetime as dt
    from app.services.documentation import generate_model_documentation

    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    # Fetch sibling models from the same dataset for the leaderboard table
    sibling_models = db.query(MLModel).filter(
        MLModel.dataset_id == model.dataset_id,
        MLModel.status.notin_([ModelStatus.TRAINING, ModelStatus.FAILED]),
    ).all()

    pdf_buffer = generate_model_documentation(model, sibling_models)

    safe_name = (model.name or model_id).replace(' ', '_')
    filename = f"sentinel_model_doc_{safe_name}_{dt.utcnow().strftime('%Y%m%d')}.docx"

    return StreamingResponse(
        pdf_buffer,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


@router.get("/{model_id}/risk-amount-matrix")
def get_risk_amount_matrix(
    model_id: str,
    amount_col: str,
    n_buckets: int = 5,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Group all scored observations by (risk_bin × amount_bin) and return bad rates.
    Uses the scored dataset stored at training time — no retraining needed.
    """
    import json, os, tempfile
    import pandas as pd
    from app.services.storage import storage

    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    scored_data_key = (model.metrics or {}).get("scored_data_key")
    if not scored_data_key:
        raise HTTPException(status_code=404, detail="No scored data available. Retrain model to enable this feature.")

    # Load scored data from storage
    tmp_path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as tmp:
            tmp_path = tmp.name
        storage.download_file(scored_data_key, tmp_path)
        with open(tmp_path, "r") as f:
            data = json.load(f)
    finally:
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)

    if amount_col not in data:
        raise HTTPException(status_code=400, detail=f"Column '{amount_col}' not in scored dataset")

    df = pd.DataFrame({
        "score":  data["score"],
        "target": data["target"],
        "amount": data[amount_col],
    }).dropna()

    if len(df) < 50:
        raise HTTPException(status_code=400, detail="Not enough data to build matrix")

    # Risk bins: same number as calibration, quantile-based on full scored population
    n_bins = len((model.metrics or {}).get("calibration", [])) or 10
    df["risk_bin"] = pd.qcut(df["score"], n_bins, labels=False, duplicates="drop")

    # Amount buckets: round-number boundaries
    amt_min = float(df["amount"].min())
    amt_max = float(df["amount"].max())
    raw_step = (amt_max - amt_min) / n_buckets
    if   raw_step >= 5000: round_to = 5000
    elif raw_step >= 1000: round_to = 1000
    elif raw_step >= 500:  round_to = 500
    elif raw_step >= 100:  round_to = 100
    else:                  round_to = 10

    boundaries = []
    for i in range(n_buckets + 1):
        b = amt_min + i * (amt_max - amt_min) / n_buckets
        boundaries.append(round(b / round_to) * round_to)
    boundaries = sorted(set(boundaries))
    boundaries[0]  = min(boundaries[0], amt_min)
    boundaries[-1] = max(boundaries[-1], amt_max) + 0.01

    df["amt_bucket"] = pd.cut(df["amount"], bins=boundaries, include_lowest=True, right=False)

    cross_tab = df.groupby(["risk_bin", "amt_bucket"], observed=True).agg(
        count=("target", "count"),
        bad_rate=("target", "mean")
    ).reset_index()

    rows = []
    for _, row in cross_tab.iterrows():
        if pd.isna(row["bad_rate"]) or row["count"] == 0:
            continue
        bucket = row["amt_bucket"]
        rows.append({
            "decile":     int(row["risk_bin"]) + 1,
            "bucket_min": float(bucket.left),
            "bucket_max": float(bucket.right),
            "count":      int(row["count"]),
            "bad_rate":   round(float(row["bad_rate"]), 4),
        })

    # Also return the available numeric columns for column switching
    available_cols = [k for k in data.keys() if k not in ("score", "target")]
    return {"rows": rows, "amount_col": amount_col, "available_cols": available_cols}


@router.delete("/{model_id}")
def delete_model(
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == model_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
        
    try:
        # Check if active?
        if model.status == ModelStatus.ACTIVE:
             raise HTTPException(status_code=400, detail="Cannot delete an ACTIVE model. Activate another one first.")

        db.delete(model)
        db.commit()
    except HTTPException:
        raise
    except Exception as e:
        print(f"Delete failed: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete model")
        
    return {"message": "Model deleted"}
