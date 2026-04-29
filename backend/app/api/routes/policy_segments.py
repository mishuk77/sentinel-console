from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Dict
from datetime import datetime
from app.db.session import SessionLocal
from app.models.policy_segment import PolicySegment
from app.models.policy import Policy
from app.models.ml_model import MLModel
from app.models.dataset import Dataset
from app.models.decision_system import DecisionSystem
from app.api import deps
from app.models.user import User

router = APIRouter()

CALIBRATION_TARGET = 500  # samples needed for full confidence


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ─── Pydantic schemas ────────────────────────────────────────────────────────

class CalibrateRequest(BaseModel):
    target_bad_rate: Optional[float] = None  # e.g. 0.12 = 12% max portfolio bad rate


class SegmentCreate(BaseModel):
    name: str
    filters: Dict[str, str] = {}
    threshold: Optional[float] = None


class SegmentUpdate(BaseModel):
    name: Optional[str] = None
    override_threshold: Optional[float] = None
    override_reason: Optional[str] = None


class SegmentResponse(BaseModel):
    id: str
    policy_id: str
    name: str
    filters: dict
    specificity: int
    threshold: Optional[float] = None
    override_threshold: Optional[float] = None
    override_reason: Optional[str] = None
    override_by: Optional[str] = None
    n_samples: Optional[int] = None
    default_rate: Optional[float] = None
    confidence_score: Optional[float] = None
    confidence_tier: Optional[str] = None
    projected_approval_rate: Optional[float] = None
    fallback_segment_id: Optional[str] = None
    is_global: bool
    is_active: bool
    created_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _get_policy_authorized(policy_id: str, db: Session, current_user: User) -> Policy:
    policy = db.query(Policy).join(DecisionSystem).filter(
        Policy.id == policy_id,
        DecisionSystem.client_id == current_user.client_id
    ).first()
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    return policy


def _resolve_fallback(segment: PolicySegment, all_segments: list) -> Optional[str]:
    """
    Dimension-reduction fallback: walk from (specificity-1) down to Global,
    picking the highest-sample qualified ancestor.
    """
    filters = segment.filters or {}
    if not filters:
        return None

    dimension_keys = list(filters.keys())

    candidates_by_level: dict = {}
    for s in all_segments:
        if s.id == segment.id:
            continue
        level = len(s.filters) if s.filters else 0
        candidates_by_level.setdefault(level, []).append(s)

    for level in range(len(dimension_keys) - 1, -1, -1):
        bucket = candidates_by_level.get(level, [])
        matching = []
        for candidate in bucket:
            if level == 0:  # Global — always qualifies
                matching.append(candidate)
            else:
                cand_filters = candidate.filters or {}
                if all(filters.get(k) == v for k, v in cand_filters.items()):
                    matching.append(candidate)
        if matching:
            return max(matching, key=lambda s: s.n_samples or 0).id

    return None


# ─── Inference helpers ───────────────────────────────────────────────────────

def _predict_proba_from_artifact(artifact, X_raw):
    """
    Produce P(positive) scores from a loaded model artifact.

    `X_raw` is a DataFrame of the *original* feature columns (id and target
    already stripped). Schema v2 artifacts carry their own preprocessor and
    encode internally; legacy artifacts get the legacy get_dummies + reindex
    treatment.

    Handles four cases:
      1. Schema v2 dict: {"schema_version": 2, "model", "preprocessor",
         "scaler", "use_scaled", "columns"}  — runs preprocessor.transform
         on raw X, optionally scales, then predict_proba.
      2. Legacy individual model dict: {"model": clf, "scaler", "columns"}
         — get_dummies on the fly + reindex to training columns.
      3. Raw sklearn model (has predict_proba directly).
      4. Ensemble meta dict: {"components": [...], "weights": [...],
         "loaded_components": {...}}.
    """
    import numpy as np
    import pandas as pd

    # Case 1: Schema v2 — preprocessor + use_scaled
    if isinstance(artifact, dict) and artifact.get("schema_version") == 2 and "preprocessor" in artifact:
        clf = artifact["model"]
        preprocessor = artifact["preprocessor"]
        scaler = artifact.get("scaler")
        use_scaled = artifact.get("use_scaled", False)

        X_processed = preprocessor.transform(X_raw)
        if use_scaled and scaler is not None:
            X_final = pd.DataFrame(
                scaler.transform(X_processed),
                columns=X_processed.columns,
                index=X_processed.index,
            )
        else:
            X_final = X_processed
        return clf.predict_proba(X_final)[:, 1]

    # Case 3: raw sklearn model
    if hasattr(artifact, "predict_proba"):
        X_input = X_raw
        if hasattr(artifact, "feature_names_in_"):
            # Best-effort: get_dummies first, then reindex to feature names
            X_input = pd.get_dummies(X_raw, dummy_na=True).fillna(0)
            X_input = X_input.reindex(columns=artifact.feature_names_in_, fill_value=0)
        return artifact.predict_proba(X_input)[:, 1]

    if not isinstance(artifact, dict):
        raise ValueError(f"Unsupported artifact type: {type(artifact)}")

    # Case 4: ensemble meta — components are nested artifacts
    if "components" in artifact and "weights" in artifact:
        loaded = artifact.get("loaded_components")
        if not loaded:
            raise ValueError(
                "Ensemble artifact requires loaded component models. "
                "Call _load_model_artifact first."
            )
        weights = artifact["weights"]
        component_names = artifact["components"]
        scores = np.zeros(len(X_raw))
        for name, w in zip(component_names, weights):
            comp = loaded[name]
            comp_scores = _predict_proba_from_artifact(comp, X_raw)
            scores += w * comp_scores
        return scores

    # Case 2: legacy individual model wrapper dict — encode here, then reindex
    if "model" in artifact:
        model = artifact["model"]
        scaler = artifact.get("scaler")
        columns = artifact.get("columns")
        X_input = pd.get_dummies(X_raw, dummy_na=True).fillna(0)
        if columns:
            for col in columns:
                if col not in X_input.columns:
                    X_input[col] = 0
            X_input = X_input[columns]
        if scaler is not None:
            X_input = scaler.transform(X_input)
        return model.predict_proba(X_input)[:, 1]

    raise ValueError(f"Unrecognised artifact dict keys: {list(artifact.keys())}")


def _score_segment(X_raw, y, seg_mask, artifact):
    """
    Filter X_raw/y to seg_mask rows, score with the model artifact, bin into deciles.
    `X_raw` is the original feature DataFrame (not one-hot encoded). The artifact
    helper handles schema-specific encoding internally.

    Returns list of calibration dicts or None if not enough data.
    """
    import pandas as pd

    X_seg = X_raw[seg_mask.values].copy()
    y_seg = y[seg_mask.values]
    n = len(X_seg)
    if n < 10:
        return None

    scores = _predict_proba_from_artifact(artifact, X_seg)
    eval_df = pd.DataFrame({"score": scores, "target": y_seg.values})
    # Dynamic bins: ~200 obs per bin, capped 10–50, minimum 5
    n_bins = max(5, min(50, n // 200)) if n >= 100 else 5

    try:
        eval_df["decile"] = pd.qcut(eval_df["score"], n_bins, labels=False, duplicates="drop")
    except Exception:
        return None

    calibration = []
    metrics = eval_df.groupby("decile").agg({
        "score": ["min", "max"],
        "target": ["count", "mean"]
    }).sort_index()

    for idx, row in metrics.iterrows():
        calibration.append({
            "decile": int(idx) + 1,
            "min_score": float(row[("score", "min")]),
            "max_score": float(row[("score", "max")]),
            "actual_rate": float(row[("target", "mean")]),
            "count": int(row[("target", "count")])
        })
    return calibration


def _compute_approval_rate(calibration: list, threshold: float) -> Optional[float]:
    """Fraction of segment population that would be approved at the given threshold."""
    total = sum(b["count"] for b in calibration)
    if total == 0:
        return None
    approved = sum(b["count"] for b in calibration if b["max_score"] <= threshold + 0.00001)
    return round(approved / total, 4)


def _find_threshold_for_bad_rate(calibration: list, target_bad_rate: float) -> Optional[float]:
    """
    Walk deciles low-to-high (lowest risk first). Return the max_score of the last
    consecutive decile whose individual bad rate is <= target_bad_rate.
    Stops at the first decile that exceeds the per-decile limit.
    """
    sorted_cal = sorted(calibration, key=lambda x: x["decile"])
    threshold = None
    for bin_ in sorted_cal:
        if bin_["actual_rate"] <= target_bad_rate:
            threshold = bin_["max_score"]
        else:
            break  # first decile exceeding the limit — stop
    return threshold


def _load_model_artifact(artifact_path: str, model_record, db: Session, storage):
    """
    Load a model artifact from storage. If it's an ensemble meta-dict, also load
    all component model artifacts and inject them under 'loaded_components'.
    """
    import tempfile, os, joblib

    tmp_fd, model_path = tempfile.mkstemp(suffix=".pkl")
    os.close(tmp_fd)
    try:
        storage.download_file(artifact_path, model_path)
        artifact = joblib.load(model_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load model artifact: {str(e)}")
    finally:
        if os.path.exists(model_path):
            os.remove(model_path)

    # If it's an ensemble meta-dict, load each component model
    if isinstance(artifact, dict) and "components" in artifact and "weights" in artifact:
        component_names = artifact["components"]
        loaded = {}
        for comp_name in component_names:
            # Component models share the same job — find them by name + dataset
            comp_model = db.query(MLModel).filter(
                MLModel.dataset_id == model_record.dataset_id,
                MLModel.algorithm == comp_name,
                MLModel.artifact_path.isnot(None)
            ).order_by(MLModel.created_at.desc()).first()

            if not comp_model or not comp_model.artifact_path:
                raise HTTPException(
                    status_code=500,
                    detail=f"Ensemble component '{comp_name}' artifact not found"
                )

            tmp_fd2, comp_path = tempfile.mkstemp(suffix=".pkl")
            os.close(tmp_fd2)
            try:
                storage.download_file(comp_model.artifact_path, comp_path)
                loaded[comp_name] = joblib.load(comp_path)
            except Exception as e:
                raise HTTPException(
                    status_code=500,
                    detail=f"Failed to load component '{comp_name}': {str(e)}"
                )
            finally:
                if os.path.exists(comp_path):
                    os.remove(comp_path)

        artifact["loaded_components"] = loaded

    return artifact


# ─── Routes ──────────────────────────────────────────────────────────────────

@router.get("/{policy_id}/segments", response_model=List[SegmentResponse])
def list_segments(
    policy_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    _get_policy_authorized(policy_id, db, current_user)
    segments = (
        db.query(PolicySegment)
        .filter(PolicySegment.policy_id == policy_id, PolicySegment.is_active == True)
        .order_by(PolicySegment.n_samples.desc())
        .all()
    )
    return segments


@router.post("/{policy_id}/segments", response_model=SegmentResponse)
def create_segment(
    policy_id: str,
    data: SegmentCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    policy = _get_policy_authorized(policy_id, db, current_user)

    segment = PolicySegment(
        policy_id=policy_id,
        name=data.name,
        filters=data.filters or {},
        specificity=len(data.filters or {}),
        threshold=data.threshold or policy.threshold,
        is_global=(len(data.filters or {}) == 0),
    )
    db.add(segment)
    db.commit()
    db.refresh(segment)
    return segment


@router.put("/{policy_id}/segments/{segment_id}", response_model=SegmentResponse)
def update_segment(
    policy_id: str,
    segment_id: str,
    data: SegmentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    _get_policy_authorized(policy_id, db, current_user)

    segment = db.query(PolicySegment).filter(
        PolicySegment.id == segment_id,
        PolicySegment.policy_id == policy_id
    ).first()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    if data.name is not None:
        segment.name = data.name
    if "override_threshold" in data.model_fields_set:
        segment.override_threshold = data.override_threshold
        segment.override_by = current_user.email if hasattr(current_user, "email") else str(current_user.id)
    if data.override_reason is not None:
        segment.override_reason = data.override_reason

    db.commit()
    db.refresh(segment)
    return segment


@router.delete("/{policy_id}/segments/{segment_id}")
def delete_segment(
    policy_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    _get_policy_authorized(policy_id, db, current_user)

    segment = db.query(PolicySegment).filter(
        PolicySegment.id == segment_id,
        PolicySegment.policy_id == policy_id
    ).first()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    db.delete(segment)
    db.commit()
    return {"message": "Segment deleted"}


@router.get("/{policy_id}/segments/{segment_id}/calibration")
async def get_segment_calibration(
    policy_id: str,
    segment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Run per-segment model inference: filter dataset to segment rows,
    apply same preprocessing as training, score with the policy model,
    bin into deciles, return calibration array.
    """
    policy = _get_policy_authorized(policy_id, db, current_user)

    segment = db.query(PolicySegment).filter(
        PolicySegment.id == segment_id,
        PolicySegment.policy_id == policy_id
    ).first()
    if not segment:
        raise HTTPException(status_code=404, detail="Segment not found")

    model = db.query(MLModel).filter(MLModel.id == policy.model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.artifact_path:
        raise HTTPException(status_code=404, detail="Model artifact not found — retrain the model")

    dataset = db.query(Dataset).filter(Dataset.id == model.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    import tempfile, os
    import pandas as pd
    import joblib
    from app.services.storage import storage

    # ── Load dataset ──────────────────────────────────────────────────────────
    tmp_fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        storage.download_file(dataset.s3_key, temp_path)
        df = pd.read_csv(temp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    # ── Determine label column (TASK-6: prefer model.target_column) ────────────
    from app.models.ml_model import MLModel
    metadata = dataset.metadata_info or {}
    latest_model = (
        db.query(MLModel)
        .filter(MLModel.dataset_id == dataset.id)
        .filter(MLModel.target_column.isnot(None))
        .order_by(MLModel.created_at.desc())
        .first()
    )
    label_col = (
        (latest_model.target_column if latest_model else None)
        or metadata.get("label_column")
        or "charge_off"
    )
    if label_col not in df.columns:
        for candidate in ["charge_off", "default", "label", "target", "is_default"]:
            if candidate in df.columns:
                label_col = candidate
                break
        else:
            raise HTTPException(status_code=400, detail="Label column not found in dataset")

    # ── Segment mask (computed on raw df, before encoding) ────────────────────
    mask = pd.Series([True] * len(df))
    if segment.filters:
        for col, val in segment.filters.items():
            if col in df.columns:
                mask = mask & (df[col].astype(str) == str(val))
            else:
                mask = pd.Series([False] * len(df))

    # ── Build raw feature matrix (schema-aware encoding happens later) ────────
    # Schema v2 artifacts replay their training preprocessor on RAW columns;
    # legacy artifacts get one-hot encoded inside _predict_proba_from_artifact.
    exclude_lower = {"id", "customer_id", "created_at", "applicant_id", "uuid", "name", "email", "phone", label_col.lower()}
    cols = [
        c for c in df.columns
        if c.lower() not in exclude_lower and not c.lower().endswith("id")
    ]
    X = df[cols].copy()
    y = df[label_col]

    n = int(mask.sum())

    # ── Load model artifact ───────────────────────────────────────────────────
    artifact = _load_model_artifact(model.artifact_path, model, db, storage)

    # ── Score via shared helper ───────────────────────────────────────────────
    calibration = _score_segment(X, y, mask, artifact)
    if calibration is None:
        raise HTTPException(
            status_code=400,
            detail=f"Not enough segment data for inference (minimum 10 rows required)"
        )

    return {
        "segment_id": segment_id,
        "n_samples": n,
        "calibration": calibration
    }


@router.post("/{policy_id}/segments/calibrate", response_model=List[SegmentResponse])
async def calibrate_segments(
    policy_id: str,
    body: CalibrateRequest = CalibrateRequest(),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """
    Phase 1 — count samples per segment, compute confidence tiers, resolve fallback chains.
    Phase 2 (optional) — if target_bad_rate is provided, load the model artifact once,
    score every non-red segment, and set threshold to the max score where cumulative
    bad rate <= target_bad_rate.
    """
    import tempfile
    import os
    import pandas as pd
    import joblib
    from app.services.storage import storage

    policy = _get_policy_authorized(policy_id, db, current_user)

    model = db.query(MLModel).filter(MLModel.id == policy.model_id).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")

    dataset = db.query(Dataset).filter(Dataset.id == model.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    segments = (
        db.query(PolicySegment)
        .filter(PolicySegment.policy_id == policy_id, PolicySegment.is_active == True)
        .all()
    )
    if not segments:
        return []

    # ── Load dataset ──────────────────────────────────────────────────────────
    tmp_fd, temp_path = tempfile.mkstemp(suffix=".csv")
    os.close(tmp_fd)
    try:
        storage.download_file(dataset.s3_key, temp_path)
        df = pd.read_csv(temp_path)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to load dataset: {str(e)}")
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

    # ── Determine label column (TASK-6: prefer model.target_column) ────────────
    from app.models.ml_model import MLModel
    metadata = dataset.metadata_info or {}
    latest_model = (
        db.query(MLModel)
        .filter(MLModel.dataset_id == dataset.id)
        .filter(MLModel.target_column.isnot(None))
        .order_by(MLModel.created_at.desc())
        .first()
    )
    label_col = (
        (latest_model.target_column if latest_model else None)
        or metadata.get("label_column")
        or "charge_off"
    )
    if label_col not in df.columns:
        for candidate in ["charge_off", "default", "label", "target", "is_default"]:
            if candidate in df.columns:
                label_col = candidate
                break
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Label column not found in dataset. Available: {list(df.columns)}"
            )

    global_n = len(df)
    global_defaults = float(df[label_col].sum())
    global_default_rate = global_defaults / global_n if global_n > 0 else 0.0

    # ── Phase 1: sample counts, confidence tiers ──────────────────────────────
    seg_masks: dict = {}  # segment.id -> boolean mask Series (for Phase 2)

    for seg in segments:
        seg.specificity = len(seg.filters) if seg.filters else 0

        if seg.is_global or not seg.filters:
            seg.n_samples = global_n
            seg.default_rate = round(global_default_rate, 6)
            seg.confidence_score = 1.0
            seg.confidence_tier = "green"
            if seg.threshold is None:
                seg.threshold = policy.threshold
            seg_masks[seg.id] = pd.Series([True] * len(df))
        else:
            mask = pd.Series([True] * len(df))
            for col, val in seg.filters.items():
                if col in df.columns:
                    mask = mask & (df[col].astype(str) == str(val))
                else:
                    mask = pd.Series([False] * len(df))
            seg_masks[seg.id] = mask

            filtered = df[mask]
            n = len(filtered)
            defaults = float(filtered[label_col].sum()) if n > 0 else 0.0
            dr = defaults / n if n > 0 else 0.0

            seg.n_samples = n
            seg.default_rate = round(dr, 6)
            seg.confidence_score = round(min(1.0, n / CALIBRATION_TARGET), 4)

            if seg.confidence_score >= 0.8:
                seg.confidence_tier = "green"
            elif seg.confidence_score >= 0.2:
                seg.confidence_tier = "yellow"
            else:
                seg.confidence_tier = "red"

            if seg.threshold is None:
                seg.threshold = policy.threshold

    db.commit()

    # Resolve fallback chains
    for seg in segments:
        if not seg.is_global and seg.confidence_tier == "red":
            seg.fallback_segment_id = _resolve_fallback(seg, segments)
    db.commit()

    # ── Phase 2: score all segments, optionally solve bad-rate thresholds ────────
    if model.artifact_path:
        target = body.target_bad_rate  # may be None

        # Build raw feature matrix once. Schema v2 artifacts replay their
        # training preprocessor inside _predict_proba_from_artifact, so we
        # must NOT one-hot encode here — doing so strips the original
        # categorical columns the preprocessor expects (e.g. `state`).
        exclude_lower = {
            "id", "customer_id", "created_at", "applicant_id",
            "uuid", "name", "email", "phone", label_col.lower()
        }
        cols = [
            c for c in df.columns
            if c.lower() not in exclude_lower and not c.lower().endswith("id")
        ]
        X_full = df[cols].copy()
        y_full = df[label_col]

        # Load model artifact once (handles individual models, ensemble meta-dicts, etc.)
        try:
            artifact = _load_model_artifact(model.artifact_path, model, db, storage)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                "Segment calibration: failed to load model artifact: %s", e
            )
            artifact = None

        if artifact is not None:
            for seg in segments:
                mask = seg_masks.get(seg.id)
                if mask is None:
                    continue
                try:
                    cal = _score_segment(X_full, y_full, mask, artifact)
                except Exception as e:
                    import logging
                    logging.getLogger(__name__).warning(
                        "Segment %s scoring failed: %s", seg.id, e
                    )
                    cal = None
                if not cal:
                    continue

                if seg.confidence_tier != "red" and target is not None:
                    # Solve for bad-rate threshold on calibrated segments
                    t = _find_threshold_for_bad_rate(cal, target)
                    if t is not None:
                        seg.threshold = round(t, 6)
                        seg.override_threshold = None
                        seg.override_reason = f"Auto-calibrated: reject deciles above {target * 100:.1f}% bad rate"
                        seg.override_by = current_user.email if hasattr(current_user, "email") else str(current_user.id)

                # Compute projected approval for ALL segments:
                # red segments use the global policy threshold (inherited)
                if seg.confidence_tier == "red":
                    effective_t = policy.threshold
                else:
                    effective_t = seg.override_threshold if seg.override_threshold is not None else seg.threshold
                if effective_t is not None:
                    seg.projected_approval_rate = _compute_approval_rate(cal, effective_t)

            db.commit()

    db.expire_all()
    return (
        db.query(PolicySegment)
        .filter(PolicySegment.policy_id == policy_id, PolicySegment.is_active == True)
        .order_by(PolicySegment.n_samples.desc())
        .all()
    )
