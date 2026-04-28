"""
Simulation routes — wraps the deterministic portfolio_simulation engine for
the frontend.

Endpoints:
    POST /simulate/portfolio
        Run a 3-stage simulation (baseline / cuts / cuts+ladder) on a
        dataset against a model + policy config. Used by:
          - TASK-3 Exposure Control 3-stage table
          - TASK-2 global policy slider (single-stage view from same response)
          - TASK-7 projected simulation summary

The endpoint takes the policy parameters in the request body (cutoff +
optional ladder) so the frontend can simulate proposed changes without
mutating any saved policy. To save a configuration, the frontend uses
PATCH /policies/{id} (separately) — see TASK-11E flow.

Caching: row-level scores are cached per (model_id, dataset_id) so
repeated simulations against different policy configs are fast. The cache
is keyed on the model artifact path (which embeds version_id) so any
re-trained model busts the cache automatically.

Audit metadata (TASK-11C): every response includes a `meta` block with
dataset/model/policy versions and the computation timestamp so the
frontend can populate its audit info panel without a second request.
"""
from __future__ import annotations

import hashlib
import io
import os
import time
from datetime import datetime
from typing import Optional

import joblib
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import SessionLocal
from app.models.dataset import Dataset
from app.models.decision_system import DecisionSystem
from app.models.ml_model import MLModel
from app.models.user import User
from app.services.loss_metadata import resolve_loss_handling
from app.services.portfolio_simulation import (
    PolicyConfig,
    SimulationInputs,
    simulate_portfolio,
    diff_policies,
    break_out_by_dimension,
)
from app.services.storage import storage

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


# ────────────────────────────────────────────────────────────────────────
# Request / response models
# ────────────────────────────────────────────────────────────────────────


class SimulateRequest(BaseModel):
    """Body of POST /simulate/portfolio."""

    dataset_id: str
    model_id: str
    cutoff: float
    amount_ladder: Optional[dict] = None
    n_deciles: int = 10

    model_config = {"protected_namespaces": ()}


class StageMetricsOut(BaseModel):
    stage_name: str
    total_applications: int
    approval_count: int
    approval_rate: float
    total_approved_dollars: Optional[float] = None
    avg_approved_dollars: Optional[float] = None
    predicted_loss_count: float
    predicted_loss_rate_count: float
    total_predicted_loss_dollars: Optional[float] = None
    predicted_loss_rate_dollars: Optional[float] = None
    net_risk_adjusted_dollars: Optional[float] = None


class StageDeltaOut(BaseModel):
    metric_name: str
    baseline_value: Optional[float] = None
    final_value: Optional[float] = None
    delta_absolute: Optional[float] = None
    delta_relative: Optional[float] = None


class AuditMetaOut(BaseModel):
    """TASK-11C audit metadata. Returned alongside every simulation result
    so the frontend audit info panel can populate without a second call."""

    dataset_id: str
    dataset_filename: Optional[str]
    dataset_row_count: Optional[int]
    dataset_content_hash: Optional[str]  # md5 of S3 key + filename + row count

    model_id: str
    model_name: Optional[str]
    model_algorithm: Optional[str]
    model_artifact_path: Optional[str]

    policy_cutoff: float
    policy_has_ladder: bool

    loss_mode: str  # "mode_1" | "mode_2" | "mode_3"
    loss_mode_footnote: str
    target_column: Optional[str]
    approved_amount_column: Optional[str]

    computed_at: str  # ISO 8601 timestamp
    computed_by: Optional[str]  # user email

    engine_version: str  # bumped if simulation engine math changes
    elapsed_ms: int


class SimulateResponse(BaseModel):
    baseline: StageMetricsOut
    policy_cuts: StageMetricsOut
    policy_cuts_ladder: StageMetricsOut
    deltas_vs_baseline: list[StageDeltaOut]
    n_rows_total: int
    n_rows_unscoreable: int
    has_dollar_metrics: bool
    meta: AuditMetaOut


# ────────────────────────────────────────────────────────────────────────
# In-process row-score cache
# ────────────────────────────────────────────────────────────────────────
#
# Scoring 50K rows takes 1-3 seconds with TreeExplainer in batch. We don't
# want every slider drag to incur that cost. Cache the row-level score
# array per (model_id, dataset_id) — busted automatically when artifact
# path changes (which embeds version_id).

_score_cache: dict[tuple[str, str], dict] = {}


def _cache_key(model_id: str, dataset_id: str, artifact_path: str) -> tuple[str, str]:
    return (f"{model_id}::{artifact_path}", dataset_id)


# ────────────────────────────────────────────────────────────────────────
# Engine version — bump when math changes incompatibly
# ────────────────────────────────────────────────────────────────────────

_ENGINE_VERSION = "1.0.0"


# ────────────────────────────────────────────────────────────────────────
# Endpoints
# ────────────────────────────────────────────────────────────────────────


class PolicyParams(BaseModel):
    cutoff: float
    amount_ladder: Optional[dict] = None
    label: Optional[str] = None  # e.g. "current production" or "proposed"
    model_config = {"protected_namespaces": ()}


class BreakoutRequest(BaseModel):
    """Body of POST /simulate/breakout — TASK-11F segment breakouts."""
    dataset_id: str
    model_id: str
    cutoff: float
    amount_ladder: Optional[dict] = None
    n_deciles: int = 10
    dimension: str  # the column name to break out by
    stage: str = "policy_cuts_ladder"  # baseline | policy_cuts | policy_cuts_ladder
    model_config = {"protected_namespaces": ()}


@router.post("/breakout")
def simulate_breakout_endpoint(
    req: BreakoutRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Per-segment metrics for a single stage. Used by the TASK-11F
    "Break out by segment" toggle on aggregate views.

    Reconciliation invariant: sum of per-segment metrics equals the
    portfolio total for the same stage. Verified by tests in
    test_segment_breakout.py.
    """
    # Auth
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == req.model_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Validate the dimension column is tagged on the dataset (per spec)
    seg_dims = dataset.segmenting_dimensions or []
    if req.dimension not in seg_dims:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Column '{req.dimension}' is not tagged as a segmenting "
                f"dimension on this dataset. Tag it via PATCH "
                f"/datasets/{{id}}/metadata first. Currently tagged: "
                f"{seg_dims}"
            ),
        )

    # Score (cached) and read the dimension column from the raw dataset
    scores, requested_amounts = _score_dataset(db, model, dataset)

    local_csv = f"temp_breakout_{dataset.id[:8]}.csv"
    try:
        storage.download_file(dataset.s3_key, local_csv)
        df = pd.read_csv(local_csv)
    finally:
        if os.path.exists(local_csv):
            os.remove(local_csv)

    if req.dimension not in df.columns:
        raise HTTPException(
            status_code=400,
            detail=f"Column '{req.dimension}' not present in dataset CSV.",
        )

    dimension_values = df[req.dimension].astype(str).tolist()

    inputs = SimulationInputs(scores=scores, requested_amounts=requested_amounts)
    policy = PolicyConfig(
        cutoff=req.cutoff,
        amount_ladder=req.amount_ladder,
        n_deciles=req.n_deciles,
    )

    breakouts = break_out_by_dimension(
        inputs, policy, dimension_values, req.dimension, stage=req.stage,
    )

    return {
        "dimension": req.dimension,
        "stage": req.stage,
        "segments": [b.to_dict() for b in breakouts],
    }


class DiffRequest(BaseModel):
    """Body of POST /simulate/diff — TASK-11G + TASK-11H."""
    dataset_id: str
    model_id: str
    policy_a: PolicyParams  # current production / baseline
    policy_b: PolicyParams  # proposed / new
    n_deciles: int = 10
    max_ids_per_bucket: int = 100
    model_config = {"protected_namespaces": ()}


@router.post("/diff")
def simulate_diff_endpoint(
    req: DiffRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Row-level diff between two policy configurations.

    Used by:
        TASK-11G — "What changed" diff panel on the Exposure Control + Policy
                   pages. Shows newly approved / newly denied / reduced
                   applications when the user adjusts policy parameters.
        TASK-11H — "Compare against published policy" mode on simulation
                   pages. Renders side-by-side metrics for the current
                   production policy vs. the proposed configuration.

    Returns counts + dollar volumes + capped lists of application IDs for
    each diff bucket, plus full StageMetrics for both policies for
    side-by-side rendering.
    """
    # Auth
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == req.model_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # Score (cached)
    scores, requested_amounts = _score_dataset(db, model, dataset)

    # Pull application IDs from the dataset if id_column is annotated
    app_ids = None
    if dataset.id_column:
        try:
            local_csv = f"temp_diff_{dataset.id[:8]}.csv"
            try:
                storage.download_file(dataset.s3_key, local_csv)
                df = pd.read_csv(local_csv)
            finally:
                if os.path.exists(local_csv):
                    os.remove(local_csv)
            if dataset.id_column in df.columns:
                app_ids = df[dataset.id_column].astype(str).tolist()
        except Exception:
            app_ids = None

    inputs = SimulationInputs(
        scores=scores,
        requested_amounts=requested_amounts,
        application_ids=app_ids,
    )
    pa = PolicyConfig(
        cutoff=req.policy_a.cutoff,
        amount_ladder=req.policy_a.amount_ladder,
        n_deciles=req.n_deciles,
    )
    pb = PolicyConfig(
        cutoff=req.policy_b.cutoff,
        amount_ladder=req.policy_b.amount_ladder,
        n_deciles=req.n_deciles,
    )

    diff = diff_policies(
        inputs, pa, pb, max_ids_per_bucket=req.max_ids_per_bucket
    )

    return {
        **diff.to_dict(),
        "policy_a_label": req.policy_a.label or "Policy A",
        "policy_b_label": req.policy_b.label or "Policy B",
        "id_column": dataset.id_column,
        "has_real_ids": app_ids is not None,
    }


@router.post("/portfolio", response_model=SimulateResponse)
def simulate_portfolio_endpoint(
    req: SimulateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Run the 3-stage portfolio simulation for the given dataset/model/policy.

    Returns full-precision metrics for baseline (approve everyone),
    policy_cuts (apply cutoff), and policy_cuts_ladder (apply cutoff +
    amount ladder), plus per-metric deltas and audit metadata.

    Performance: row-level scores are cached per (model, dataset) pair, so
    a slider drag on the same population is sub-100ms after the first
    call. Cache is invalidated automatically when the artifact path
    changes (which embeds the version_id).
    """
    t_start = time.time()

    # ── Authorization: model must belong to the user's tenant ────────
    model = db.query(MLModel).join(DecisionSystem).filter(
        MLModel.id == req.model_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not model:
        raise HTTPException(status_code=404, detail="Model not found")
    if not model.artifact_path:
        raise HTTPException(
            status_code=400,
            detail="Model has no trained artifact yet — train before simulating.",
        )

    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    # ── Score the dataset (cached) ───────────────────────────────────
    scores, requested_amounts = _score_dataset(db, model, dataset)

    # ── Run the simulation engine ────────────────────────────────────
    inputs = SimulationInputs(
        scores=scores,
        requested_amounts=requested_amounts,
    )
    policy = PolicyConfig(
        cutoff=req.cutoff,
        amount_ladder=req.amount_ladder,
        n_deciles=req.n_deciles,
    )
    result = simulate_portfolio(inputs, policy)

    # ── Audit metadata ───────────────────────────────────────────────
    loss_resolution = resolve_loss_handling(model, dataset)
    elapsed_ms = int((time.time() - t_start) * 1000)

    meta = AuditMetaOut(
        dataset_id=dataset.id,
        dataset_filename=(dataset.metadata_info or {}).get("original_filename"),
        dataset_row_count=(dataset.metadata_info or {}).get("row_count"),
        dataset_content_hash=_compute_dataset_hash(dataset),
        model_id=model.id,
        model_name=model.name,
        model_algorithm=model.algorithm,
        model_artifact_path=model.artifact_path,
        policy_cutoff=req.cutoff,
        policy_has_ladder=bool(req.amount_ladder),
        loss_mode=loss_resolution.mode,
        loss_mode_footnote=loss_resolution.ui_footnote(),
        target_column=loss_resolution.target_column,
        approved_amount_column=loss_resolution.approved_amount_column,
        computed_at=datetime.utcnow().isoformat() + "Z",
        computed_by=current_user.email if hasattr(current_user, "email") else None,
        engine_version=_ENGINE_VERSION,
        elapsed_ms=elapsed_ms,
    )

    return SimulateResponse(
        baseline=StageMetricsOut(**_stage_to_dict(result.baseline)),
        policy_cuts=StageMetricsOut(**_stage_to_dict(result.policy_cuts)),
        policy_cuts_ladder=StageMetricsOut(**_stage_to_dict(result.policy_cuts_ladder)),
        deltas_vs_baseline=[
            StageDeltaOut(
                metric_name=d.metric_name,
                baseline_value=d.baseline_value,
                final_value=d.final_value,
                delta_absolute=d.delta_absolute,
                delta_relative=d.delta_relative,
            )
            for d in result.deltas_vs_baseline
        ],
        n_rows_total=result.n_rows_total,
        n_rows_unscoreable=result.n_rows_unscoreable,
        has_dollar_metrics=result.has_dollar_metrics,
        meta=meta,
    )


# ────────────────────────────────────────────────────────────────────────
# Internals
# ────────────────────────────────────────────────────────────────────────


def _stage_to_dict(stage) -> dict:
    """Convert a StageMetrics dataclass to a dict, dropping fields that the
    response model doesn't expose (raw_* are internal bookkeeping)."""
    d = stage.to_dict()
    d.pop("raw_total_approved_dollars", None)
    d.pop("raw_total_predicted_loss_dollars", None)
    return d


def _score_dataset(db: Session, model: MLModel, dataset: Dataset):
    """
    Score every row in the dataset through the production inference path.

    Returns (scores, requested_amounts).
    requested_amounts is None when the dataset has no approved_amount_column
    set — in that case the caller (simulate_portfolio) produces Mode 3
    output (count metrics only).

    Caches the result keyed on (model_id::artifact_path, dataset_id) so
    that subsequent simulations on the same population skip the scoring
    step. Cache is automatically invalidated when the artifact path
    changes (which embeds version_id).
    """
    cache_key = _cache_key(model.id, dataset.id, model.artifact_path)
    cached = _score_cache.get(cache_key)
    if cached is not None:
        return cached["scores"], cached["amounts"]

    # ── Download dataset CSV ─────────────────────────────────────────
    local_csv = f"temp_sim_{model.id[:8]}_{dataset.id[:8]}.csv"
    try:
        storage.download_file(dataset.s3_key, local_csv)
        df = pd.read_csv(local_csv)
    finally:
        if os.path.exists(local_csv):
            os.remove(local_csv)

    # ── Determine approved amount column from metadata (TASK-6) ──────
    amount_col = dataset.approved_amount_column
    requested_amounts = None
    if amount_col and amount_col in df.columns:
        requested_amounts = pd.to_numeric(df[amount_col], errors="coerce").fillna(0).values

    # ── Score through the inference pipeline ─────────────────────────
    # Use the same code path as production (decision_service) so simulation
    # numbers match what the engine would produce for real applicants.
    artifact = _load_model_artifact(model)

    target_col = model.target_column
    feature_cols = [
        c for c in df.columns
        if c != target_col
        and c != amount_col
        and c != dataset.id_column
        and not c.lower().endswith("id")
    ]
    X = df[feature_cols].copy()

    if isinstance(artifact, dict) and artifact.get("schema_version") == 2:
        # Schema v2 — use preprocessor for the full inference pipeline
        preprocessor = artifact["preprocessor"]
        scaler = artifact.get("scaler")
        use_scaled = artifact.get("use_scaled", False)
        clf = artifact["model"]

        X_processed = preprocessor.transform(X)
        if use_scaled and scaler is not None:
            X_final = pd.DataFrame(
                scaler.transform(X_processed),
                columns=X_processed.columns,
                index=X_processed.index,
            )
        else:
            X_final = X_processed
        scores = clf.predict_proba(X_final)[:, 1]
    elif isinstance(artifact, dict) and "model" in artifact:
        # Legacy v1 path — best effort
        clf = artifact["model"]
        columns = artifact.get("columns")
        scaler = artifact.get("scaler")
        if columns:
            X = X.reindex(columns=columns, fill_value=0)
        if scaler is not None:
            try:
                X = pd.DataFrame(scaler.transform(X), columns=columns, index=X.index)
            except Exception:
                pass
        scores = clf.predict_proba(X)[:, 1]
    elif hasattr(artifact, "predict_proba"):
        if hasattr(artifact, "feature_names_in_"):
            X = X.reindex(columns=artifact.feature_names_in_, fill_value=0)
        scores = artifact.predict_proba(X)[:, 1]
    else:
        raise HTTPException(
            status_code=500,
            detail=f"Unsupported model artifact type: {type(artifact)}",
        )

    # Cache for next call (size unbounded for now — fine for single-tenant
    # demos; bound by LRU later if memory becomes an issue)
    _score_cache[cache_key] = {"scores": scores, "amounts": requested_amounts}
    return scores, requested_amounts


def _load_model_artifact(model: MLModel):
    """Download and joblib-load the model artifact. Cached on disk per
    request — small enough to round-trip via /tmp."""
    local_path = f"temp_sim_artifact_{model.id[:8]}.pkl"
    try:
        storage.download_file(model.artifact_path, local_path)
        return joblib.load(local_path)
    finally:
        if os.path.exists(local_path):
            os.remove(local_path)


def _compute_dataset_hash(dataset: Dataset) -> str:
    """Stable identifier for the dataset content. Used in audit info so
    users can verify the simulation ran against the file they think it did.

    We avoid hashing the full file content (expensive for large datasets);
    the s3_key + row_count + filename is sufficient for the audit purpose
    since none of these change on the same dataset record."""
    parts = [
        dataset.s3_key or "",
        str((dataset.metadata_info or {}).get("row_count", "?")),
        (dataset.metadata_info or {}).get("original_filename", ""),
    ]
    h = hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()
    return h[:16]
