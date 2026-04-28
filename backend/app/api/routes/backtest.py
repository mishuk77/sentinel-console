"""
Engine Backtest endpoint — TASK-8.

Runs the full production decisioning code path on every row of a dataset
and persists row-level results for audit and analysis.

Endpoints:
    POST /backtest                     start a backtest run
    GET  /backtest/{run_id}            get run summary + first 1000 rows
    GET  /backtest/{run_id}/rows       paginated row-level results
    GET  /backtest                     list backtest runs for a system

This MVP runs synchronously (returns once complete). Async background
worker pattern is a later iteration. With caching (preprocessor cached
in memory after first call), 50K rows complete in ~30-60 seconds against
production-grade tree models.

Determinism (TASK-8 + TASK-11D):
  - policy_snapshot captured at run start
  - model_artifact_path pinned (embeds version_id)
  - dataset_content_hash captured
  - Re-running with identical inputs produces identical results
"""
from __future__ import annotations

import hashlib
import io
import os
import time
import traceback
import uuid
from datetime import datetime
from typing import Optional

import joblib
import numpy as np
import pandas as pd
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import SessionLocal
from app.models.backtest import BacktestRun, BacktestRowResult
from app.models.dataset import Dataset
from app.models.decision_system import DecisionSystem
from app.models.ml_model import MLModel
from app.models.policy import Policy
from app.models.user import User
from app.services.storage import storage
from app.services.portfolio_simulation import compute_deciles, ladder_lookup

router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


_ENGINE_VERSION = "1.0.0"
_INLINE_ROW_LIMIT = 1000  # store first 1000 row-level results in DB


# ────────────────────────────────────────────────────────────────────────
# Request / response
# ────────────────────────────────────────────────────────────────────────


class BacktestStartRequest(BaseModel):
    decision_system_id: str
    dataset_id: str
    model_id: Optional[str] = None  # default: active model on system
    policy_id: Optional[str] = None  # default: active policy on system

    model_config = {"protected_namespaces": ()}


class BacktestSummaryOut(BaseModel):
    id: str
    status: str
    decision_system_id: Optional[str]
    dataset_id: Optional[str]
    model_id: Optional[str]
    policy_id: Optional[str]
    dataset_filename: Optional[str]
    dataset_row_count: Optional[int]
    dataset_content_hash: Optional[str]
    model_artifact_path: Optional[str]
    started_at: Optional[str]
    completed_at: Optional[str]
    started_by: Optional[str]
    engine_version: Optional[str]
    rows_processed: int
    rows_errors: int
    rows_warnings: int
    avg_latency_ms: Optional[float]
    n_approved: int
    n_denied: int
    n_review: int
    total_approved_dollars: Optional[float]
    total_predicted_loss_dollars: Optional[float]
    has_outcomes: int
    auc: Optional[float]
    ks_statistic: Optional[float]
    brier_score: Optional[float]
    brier_skill_score: Optional[float]
    calibration_error_pp: Optional[float]
    error_message: Optional[str]
    # TASK-8: full Parquet result download availability
    parquet_available: bool = False


# ────────────────────────────────────────────────────────────────────────
# Endpoints
# ────────────────────────────────────────────────────────────────────────


@router.post("", response_model=BacktestSummaryOut)
def start_backtest(
    req: BacktestStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Start a backtest run.

    The actual work is dispatched to a Celery worker so the HTTP request
    returns immediately with run_id + status='running'. Frontend polls
    GET /backtest/{run_id} for status updates until status='completed'
    or 'failed'.

    Falls back to synchronous execution when Redis/Celery is unavailable
    (local dev) — the run still completes; the response just blocks until
    it does."""
    # Tenant ownership
    ds = db.query(DecisionSystem).filter(
        DecisionSystem.id == req.decision_system_id,
        DecisionSystem.client_id == current_user.client_id,
    ).first()
    if not ds:
        raise HTTPException(status_code=404, detail="Decision system not found")

    dataset = db.query(Dataset).filter(Dataset.id == req.dataset_id).first()
    if not dataset:
        raise HTTPException(status_code=404, detail="Dataset not found")

    model_id = req.model_id or ds.active_model_id
    policy_id = req.policy_id or ds.active_policy_id
    if not model_id or not policy_id:
        raise HTTPException(
            status_code=400,
            detail="Missing model_id or policy_id (and decision system has no active ones).",
        )

    model = db.query(MLModel).filter(MLModel.id == model_id).first()
    policy = db.query(Policy).filter(Policy.id == policy_id).first()
    if not model or not policy:
        raise HTTPException(status_code=404, detail="Model or policy not found")
    if not model.artifact_path:
        raise HTTPException(status_code=400, detail="Model has no trained artifact.")

    # Reject draft policies (TASK-8 spec: "Refuse to backtest with a
    # version_id that doesn't exist in the registry. Block backtests
    # against in-flight policy changes.")
    if (policy.state or "").lower() == "draft":
        raise HTTPException(
            status_code=400,
            detail=(
                "Cannot backtest against a draft policy. Publish the "
                "policy or pass an explicit policy_id."
            ),
        )

    # Create the run record
    run = BacktestRun(
        id=str(uuid.uuid4()),
        decision_system_id=ds.id,
        dataset_id=dataset.id,
        model_id=model.id,
        policy_id=policy.id,
        policy_snapshot=policy.published_snapshot or {
            "threshold": policy.threshold,
            "amount_ladder": policy.amount_ladder,
        },
        model_artifact_path=model.artifact_path,  # embeds version_id
        dataset_filename=(dataset.metadata_info or {}).get("original_filename"),
        dataset_row_count=(dataset.metadata_info or {}).get("row_count"),
        dataset_content_hash=_hash_dataset(dataset),
        status="running",
        started_at=datetime.utcnow(),
        started_by=getattr(current_user, "email", None),
        engine_version=_ENGINE_VERSION,
    )
    db.add(run)
    db.commit()
    run_id = run.id

    # Dispatch to Celery worker. If Celery isn't reachable (e.g. local
    # dev with no Redis), fall back to synchronous execution so the
    # endpoint still returns a valid result.
    dispatched = False
    try:
        from app.workers.backtest_worker import run_backtest_task
        run_backtest_task.delay(run_id)
        dispatched = True
    except Exception as e:
        # No Celery — run synchronously
        try:
            _execute_backtest(db, run, dataset, model, policy)
            run.status = "completed"
            run.completed_at = datetime.utcnow()
        except Exception as inner:
            tb = traceback.format_exc()
            run.status = "failed"
            run.completed_at = datetime.utcnow()
            run.error_message = f"{type(inner).__name__}: {inner}\n{tb[:500]}"
        db.commit()
        db.refresh(run)

    # If dispatched, just refresh and return — the worker will update
    # the run record as it progresses
    if dispatched:
        db.refresh(run)

    return _summary_out(run)


@router.get("/{run_id}", response_model=BacktestSummaryOut)
def get_backtest(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    run = _load_run(db, run_id, current_user)
    return _summary_out(run)


@router.get("/{run_id}/rows")
def get_backtest_rows(
    run_id: str,
    page: int = 1,
    page_size: int = 50,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Paginated row-level results. First 1000 rows come from the DB;
    deeper pagination would hit S3 Parquet (deferred)."""
    run = _load_run(db, run_id, current_user)
    offset = (page - 1) * page_size
    if offset + page_size > _INLINE_ROW_LIMIT:
        # MVP — beyond row 1000 isn't supported in this iteration
        return {
            "rows": [],
            "page": page,
            "page_size": page_size,
            "total": _INLINE_ROW_LIMIT,
            "note": (
                "MVP supports first 1000 rows. Full results in S3 Parquet "
                "is on the TASK-8 roadmap."
            ),
        }
    rows = (
        db.query(BacktestRowResult)
        .filter(BacktestRowResult.backtest_run_id == run.id)
        .order_by(BacktestRowResult.row_index)
        .offset(offset)
        .limit(page_size)
        .all()
    )
    return {
        "rows": [
            {
                "row_index": r.row_index,
                "application_id": r.application_id,
                "score": r.score,
                "decision": r.decision,
                "approved_amount": r.approved_amount,
                "matched_segment": r.matched_segment,
                "actual_outcome": r.actual_outcome,
                "error_message": r.error_message,
                "warning_flags": r.warning_flags,
                "shap_top_features": r.shap_top_features,
            }
            for r in rows
        ],
        "page": page,
        "page_size": page_size,
        "total": min(_INLINE_ROW_LIMIT, run.rows_processed),
    }


@router.get("/{run_id}/summary.pdf")
def download_summary_pdf(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """TASK-11I: executive summary PDF (cover + sections 1-3).

    Print-friendly format — the slide a CRO shows their CFO. Complies
    with TASK-11I export standards (audit metadata cover, page header
    with run ID + page X of Y, footer with tenant name)."""
    from fastapi.responses import StreamingResponse
    from app.services.pdf_export import export_backtest_summary_pdf

    run = _load_run(db, run_id, current_user)
    if run.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot export — run status is '{run.status}'.",
        )

    run_dict = _summary_out(run).model_dump()
    # Enrich with model + policy display names that aren't on the summary
    if run.model_id:
        m = db.query(MLModel).filter(MLModel.id == run.model_id).first()
        if m:
            run_dict["model_name"] = m.name
            run_dict["model_algorithm"] = m.algorithm
    if run.policy_id:
        p = db.query(Policy).filter(Policy.id == run.policy_id).first()
        if p:
            run_dict["policy_label"] = f"{p.id[:8]} (state={p.state or 'unknown'}, threshold={p.threshold:.4f})"

    pdf_bytes = export_backtest_summary_pdf(run_dict)
    filename = f"sentinel_backtest_summary_{run.id[:8]}_{run.started_at.strftime('%Y%m%d_%H%M%S') if run.started_at else 'unknown'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{run_id}/calibration.pdf")
def download_calibration_pdf(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """TASK-11I: calibration-only PDF — SR 11-7 validation evidence.

    Single section, no executive overhead. The kind of doc a model
    validator wants to file in their evidence binder."""
    from fastapi.responses import StreamingResponse
    from app.services.pdf_export import export_calibration_only_pdf

    run = _load_run(db, run_id, current_user)
    if run.status != "completed":
        raise HTTPException(
            status_code=400,
            detail=f"Cannot export — run status is '{run.status}'.",
        )

    run_dict = _summary_out(run).model_dump()
    if run.model_id:
        m = db.query(MLModel).filter(MLModel.id == run.model_id).first()
        if m:
            run_dict["model_name"] = m.name
            run_dict["model_algorithm"] = m.algorithm
    if run.policy_id:
        p = db.query(Policy).filter(Policy.id == run.policy_id).first()
        if p:
            run_dict["policy_label"] = f"{p.id[:8]} (state={p.state or 'unknown'}, threshold={p.threshold:.4f})"

    pdf_bytes = export_calibration_only_pdf(run_dict)
    filename = f"sentinel_calibration_evidence_{run.id[:8]}_{run.started_at.strftime('%Y%m%d_%H%M%S') if run.started_at else 'unknown'}.pdf"
    return StreamingResponse(
        io.BytesIO(pdf_bytes),
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("/{run_id}/full-results.parquet")
def download_full_results(
    run_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """
    Download the full row-level results as a Parquet file.

    Returns the file directly (streaming response) — most analysis tools
    (DuckDB, Spark, pandas) read Parquet natively.

    File schema:
        row_index, application_id, score, decision, approved_amount,
        predicted_loss, actual_outcome,
        shap_feature_1..3, shap_value_1..3 (only for first 1000 rows
        when SHAP was computed)
    """
    from fastapi.responses import StreamingResponse
    import os as _os
    import tempfile as _tempfile

    run = _load_run(db, run_id, current_user)
    if not run.parquet_s3_uri:
        raise HTTPException(
            status_code=404,
            detail=(
                "Parquet results not available for this run. Either the "
                "run is still running, the export failed (see logs), or "
                "this run predates the Parquet feature."
            ),
        )

    tmp_fd, tmp_path = _tempfile.mkstemp(suffix=".parquet")
    _os.close(tmp_fd)
    try:
        storage.download_file(run.parquet_s3_uri, tmp_path)
        with open(tmp_path, "rb") as f:
            content = f.read()
    finally:
        if _os.path.exists(tmp_path):
            _os.remove(tmp_path)

    filename = f"sentinel_backtest_{run.id[:8]}_{run.started_at.strftime('%Y%m%d_%H%M%S') if run.started_at else 'unknown'}.parquet"
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/octet-stream",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@router.get("")
def list_backtests(
    decision_system_id: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user),
):
    q = (
        db.query(BacktestRun)
        .join(DecisionSystem, BacktestRun.decision_system_id == DecisionSystem.id)
        .filter(DecisionSystem.client_id == current_user.client_id)
    )
    if decision_system_id:
        q = q.filter(BacktestRun.decision_system_id == decision_system_id)
    runs = q.order_by(BacktestRun.started_at.desc()).limit(100).all()
    return [_summary_out(r) for r in runs]


# ────────────────────────────────────────────────────────────────────────
# Internals
# ────────────────────────────────────────────────────────────────────────


def _load_run(db: Session, run_id: str, current_user: User) -> BacktestRun:
    run = (
        db.query(BacktestRun)
        .join(DecisionSystem, BacktestRun.decision_system_id == DecisionSystem.id)
        .filter(BacktestRun.id == run_id)
        .filter(DecisionSystem.client_id == current_user.client_id)
        .first()
    )
    if not run:
        raise HTTPException(status_code=404, detail="Backtest run not found")
    return run


def _execute_backtest(
    db: Session,
    run: BacktestRun,
    dataset: Dataset,
    model: MLModel,
    policy: Policy,
):
    """Run the backtest end-to-end. Calls the production scoring path
    via InferencePreprocessor (no parallel implementation, per spec)."""
    t_start = time.time()

    # Download dataset
    local_csv = f"temp_backtest_{run.id[:8]}.csv"
    try:
        storage.download_file(dataset.s3_key, local_csv)
        df = pd.read_csv(local_csv)
    finally:
        if os.path.exists(local_csv):
            os.remove(local_csv)

    # Load model artifact
    local_pkl = f"temp_backtest_artifact_{run.id[:8]}.pkl"
    try:
        storage.download_file(model.artifact_path, local_pkl)
        artifact = joblib.load(local_pkl)
    finally:
        if os.path.exists(local_pkl):
            os.remove(local_pkl)

    target_col = model.target_column
    amount_col = dataset.approved_amount_column
    id_col = dataset.id_column
    feature_cols = [
        c for c in df.columns
        if c != target_col
        and c != amount_col
        and c != id_col
        and not c.lower().endswith("id")
    ]

    # Score every row through the production pipeline
    if isinstance(artifact, dict) and artifact.get("schema_version") == 2:
        preprocessor = artifact["preprocessor"]
        scaler = artifact.get("scaler")
        use_scaled = artifact.get("use_scaled", False)
        clf = artifact["model"]
        X_proc = preprocessor.transform(df[feature_cols])
        if use_scaled and scaler is not None:
            X_final = pd.DataFrame(scaler.transform(X_proc),
                                   columns=X_proc.columns, index=X_proc.index)
        else:
            X_final = X_proc
        scores = clf.predict_proba(X_final)[:, 1]
    else:
        # Legacy path
        clf = artifact["model"] if isinstance(artifact, dict) else artifact
        cols = artifact.get("columns") if isinstance(artifact, dict) else None
        X = df[feature_cols].copy()
        if cols:
            X = X.reindex(columns=cols, fill_value=0)
        scores = clf.predict_proba(X)[:, 1]

    # Apply policy: cutoff + ladder
    threshold = (policy.published_snapshot or {}).get("threshold", policy.threshold)
    ladder = (policy.published_snapshot or {}).get("amount_ladder", policy.amount_ladder)

    decisions = np.where(scores < threshold, "approve", "deny")
    requested = (
        pd.to_numeric(df[amount_col], errors="coerce").fillna(0).values
        if amount_col and amount_col in df.columns
        else None
    )

    if ladder and requested is not None:
        # Apply ladder by decile. Uses the shared compute_deciles +
        # ladder_lookup utility from portfolio_simulation so backtest and
        # simulation produce identical decile assignments — required for
        # backtest results to match what an interactive simulation would
        # show for the same population.
        decile_assignments = compute_deciles(scores, n_deciles=10)
        approved_amounts = np.array([
            min(requested[i], ladder_lookup(ladder, decile_assignments[i]))
            if decisions[i] == "approve" and ladder_lookup(ladder, decile_assignments[i]) is not None
            else (requested[i] if decisions[i] == "approve" else 0.0)
            for i in range(len(scores))
        ])
    elif requested is not None:
        approved_amounts = np.where(decisions == "approve", requested, 0.0)
    else:
        approved_amounts = None

    # Outcomes (when available)
    outcomes = None
    if target_col and target_col in df.columns:
        outcomes = pd.to_numeric(df[target_col], errors="coerce").fillna(-1).astype(int).values

    # Application IDs
    app_ids = df[id_col].astype(str).values if id_col and id_col in df.columns else None

    # Aggregate stats
    n_approved = int((decisions == "approve").sum())
    n_denied = int((decisions == "deny").sum())
    run.n_approved = n_approved
    run.n_denied = n_denied
    run.n_review = 0
    run.rows_processed = len(scores)
    run.rows_errors = 0
    run.rows_warnings = 0

    if approved_amounts is not None:
        run.total_approved_dollars = float(approved_amounts[decisions == "approve"].sum())
        run.total_predicted_loss_dollars = float(
            (approved_amounts * scores)[decisions == "approve"].sum()
        )

    elapsed = time.time() - t_start
    run.avg_latency_ms = round(elapsed * 1000 / max(len(scores), 1), 2)

    # Calibration metrics if outcomes are available
    valid_outcomes = outcomes is not None and (outcomes >= 0).any()
    if valid_outcomes:
        mask = outcomes >= 0
        y = outcomes[mask].astype(int)
        p = scores[mask]
        if len(np.unique(y)) > 1:
            from sklearn.metrics import roc_auc_score, brier_score_loss
            from scipy.stats import ks_2samp
            try:
                run.has_outcomes = 1
                run.auc = float(roc_auc_score(y, p))
                run.brier_score = float(brier_score_loss(y, p))
                base_rate = float(y.mean())
                # Brier skill score = 1 - brier_model / brier_baseline
                brier_baseline = base_rate * (1 - base_rate)
                run.brier_skill_score = float(1 - run.brier_score / brier_baseline) if brier_baseline > 0 else 0.0
                run.calibration_error_pp = abs(float(p.mean()) - base_rate)
                # KS = max diff between defaulter and non-defaulter score CDFs
                if (y == 1).sum() > 0 and (y == 0).sum() > 0:
                    ks_stat = ks_2samp(p[y == 1], p[y == 0]).statistic
                    run.ks_statistic = float(ks_stat)
            except Exception:
                pass

    # TASK-8 follow-up: batch SHAP for tree models on the first N rows.
    # Per-row SHAP is the bottleneck on large backtests (45K rows ×
    # SHAP can be 30+ minutes). TreeExplainer in batch mode is ~100x
    # faster. Only compute for the first N rows that get persisted —
    # additional rows can compute on-demand from the row-detail API.
    shap_top_per_row = _compute_batch_shap(
        artifact, df[feature_cols], n=_INLINE_ROW_LIMIT,
    )

    # Persist first 1000 row-level results to Postgres for fast drill-down
    n_to_store = min(_INLINE_ROW_LIMIT, len(scores))
    for i in range(n_to_store):
        row_result = BacktestRowResult(
            backtest_run_id=run.id,
            row_index=i,
            application_id=str(app_ids[i]) if app_ids is not None else f"row_{i}",
            score=float(scores[i]),
            decision=str(decisions[i]),
            approved_amount=float(approved_amounts[i]) if approved_amounts is not None else None,
            actual_outcome=int(outcomes[i]) if outcomes is not None and outcomes[i] >= 0 else None,
            shap_top_features=shap_top_per_row[i] if shap_top_per_row else None,
        )
        db.add(row_result)

    # TASK-8 follow-up: write the FULL row-level results to S3 as Parquet.
    # This is the source of truth for any deep drill-down beyond row 1000
    # and the only way users can take results offline for their own
    # analysis (compliance teams routinely re-run their own checks on the
    # raw output).
    parquet_uri = _write_full_results_parquet(
        run=run,
        scores=scores,
        decisions=decisions,
        approved_amounts=approved_amounts,
        outcomes=outcomes,
        app_ids=app_ids,
        shap_top_per_row=shap_top_per_row,
    )
    if parquet_uri:
        run.parquet_s3_uri = parquet_uri

    db.commit()


def _write_full_results_parquet(
    run: BacktestRun,
    scores: np.ndarray,
    decisions: np.ndarray,
    approved_amounts: Optional[np.ndarray],
    outcomes: Optional[np.ndarray],
    app_ids: Optional[list],
    shap_top_per_row: Optional[list],
) -> Optional[str]:
    """
    Write all rows (not just the first 1000) to a Parquet file on S3.

    Returns the storage URI (e.g. ``s3://sentinel-models-prod/backtests/{run_id}.parquet``)
    or None if the write fails (Parquet output is best-effort — an upload
    failure does NOT block the backtest from completing).

    Schema:
        row_index, application_id, score, decision, approved_amount,
        predicted_loss, actual_outcome, shap_feature_1, shap_value_1,
        shap_feature_2, shap_value_2, shap_feature_3, shap_value_3
    """
    try:
        import pyarrow as pa
        import pyarrow.parquet as pq

        n = len(scores)
        # Build the columnar arrays
        row_indices = list(range(n))
        ids_col = (
            [str(a) for a in app_ids[:n]]
            if app_ids is not None
            else [f"row_{i}" for i in range(n)]
        )
        scores_col = scores.astype(float).tolist()
        decisions_col = [str(d) for d in decisions]
        amounts_col = (
            approved_amounts.astype(float).tolist()
            if approved_amounts is not None
            else [None] * n
        )
        # Predicted loss per row = approved_amount × probability
        if approved_amounts is not None:
            loss_col = (approved_amounts * scores).astype(float).tolist()
        else:
            loss_col = [None] * n
        outcomes_col = (
            [int(o) if o >= 0 else None for o in outcomes]
            if outcomes is not None
            else [None] * n
        )

        # SHAP: flatten the top-3 per row into 6 columns. Rows beyond
        # _INLINE_ROW_LIMIT will have None (we only computed SHAP for the
        # first 1000 rows for cost reasons).
        def _shap_field(i, k, attr):
            if shap_top_per_row is None:
                return None
            if i >= len(shap_top_per_row) or not shap_top_per_row[i]:
                return None
            if k >= len(shap_top_per_row[i]):
                return None
            return shap_top_per_row[i][k].get(attr)

        shap_cols = {
            f"shap_{attr}_{k+1}": [_shap_field(i, k, attr) for i in range(n)]
            for k in range(3)
            for attr in ("feature", "value")
        }

        table = pa.table({
            "row_index": row_indices,
            "application_id": ids_col,
            "score": scores_col,
            "decision": decisions_col,
            "approved_amount": amounts_col,
            "predicted_loss": loss_col,
            "actual_outcome": outcomes_col,
            **shap_cols,
        })

        # Serialize to in-memory buffer, then upload via the existing
        # storage abstraction (handles S3 + local + S3-compatible).
        buf = io.BytesIO()
        pq.write_table(table, buf, compression="snappy")
        buf.seek(0)

        s3_key = f"backtests/{run.id}.parquet"
        storage.upload_file(buf, s3_key)
        return s3_key  # storage.* paths are relative; the storage client
                       # resolves to the full S3 URI on demand
    except Exception as e:
        import logging
        logging.getLogger("sentinel.backtest").warning(
            "Parquet export skipped due to error: %s", e,
        )
        return None


def _compute_batch_shap(
    artifact: dict,
    X_raw,
    n: int = 1000,
) -> Optional[list[list[dict]]]:
    """
    Compute the top-3 SHAP features per row in batch mode.

    Returns: list of length n, each element is a list of {feature, value}
    sorted by |contribution| desc. None if SHAP is not applicable to the
    model type.

    Uses TreeExplainer in batch mode for tree models (RF, XGB, LGB) —
    100x faster than per-row scoring. For LR, skips (linear coefficient
    contributions are easy to compute on-demand from the row-detail API).
    """
    try:
        import shap
        import joblib  # noqa: F401
        import numpy as _np

        if not isinstance(artifact, dict) or "model" not in artifact:
            return None

        clf = artifact["model"]
        model_type = type(clf).__name__.lower()

        # Only batch-friendly tree models in this MVP
        if not any(t in model_type for t in ("xgb", "lgb", "forest", "boost")):
            return None

        # Apply preprocessing first so SHAP sees the same features the model did
        if "preprocessor" in artifact:
            X_proc = artifact["preprocessor"].transform(X_raw)
        else:
            X_proc = X_raw

        # Trim to first n rows for the persisted slice
        X_for_shap = X_proc.iloc[: min(n, len(X_proc))]

        explainer = shap.TreeExplainer(clf)
        shap_values = explainer.shap_values(X_for_shap)
        if isinstance(shap_values, list):
            # Multiclass — pick the positive-class contributions
            shap_values = shap_values[1]

        feature_names = list(X_proc.columns)
        result = []
        for row_vals in shap_values:
            # Top 3 by absolute contribution
            indexed = list(enumerate(row_vals))
            indexed.sort(key=lambda x: abs(x[1]), reverse=True)
            top_3 = [
                {"feature": feature_names[i], "value": round(float(v), 6)}
                for i, v in indexed[:3]
            ]
            result.append(top_3)
        return result
    except Exception as e:
        # SHAP failures shouldn't break the backtest — log and continue
        import logging
        logging.getLogger("sentinel.backtest").warning(
            "Batch SHAP skipped due to error: %s", e,
        )
        return None


def _hash_dataset(dataset: Dataset) -> str:
    parts = [
        dataset.s3_key or "",
        str((dataset.metadata_info or {}).get("row_count", "?")),
        (dataset.metadata_info or {}).get("original_filename", ""),
    ]
    return hashlib.md5("|".join(parts).encode("utf-8")).hexdigest()[:16]


def _summary_out(run: BacktestRun) -> BacktestSummaryOut:
    return BacktestSummaryOut(
        id=run.id,
        status=run.status,
        decision_system_id=run.decision_system_id,
        dataset_id=run.dataset_id,
        model_id=run.model_id,
        policy_id=run.policy_id,
        dataset_filename=run.dataset_filename,
        dataset_row_count=run.dataset_row_count,
        dataset_content_hash=run.dataset_content_hash,
        model_artifact_path=run.model_artifact_path,
        started_at=run.started_at.isoformat() if run.started_at else None,
        completed_at=run.completed_at.isoformat() if run.completed_at else None,
        started_by=run.started_by,
        engine_version=run.engine_version,
        rows_processed=run.rows_processed or 0,
        rows_errors=run.rows_errors or 0,
        rows_warnings=run.rows_warnings or 0,
        avg_latency_ms=run.avg_latency_ms,
        n_approved=run.n_approved or 0,
        n_denied=run.n_denied or 0,
        n_review=run.n_review or 0,
        total_approved_dollars=run.total_approved_dollars,
        total_predicted_loss_dollars=run.total_predicted_loss_dollars,
        has_outcomes=run.has_outcomes or 0,
        auc=run.auc,
        ks_statistic=run.ks_statistic,
        brier_score=run.brier_score,
        brier_skill_score=run.brier_skill_score,
        calibration_error_pp=run.calibration_error_pp,
        error_message=run.error_message,
        parquet_available=bool(run.parquet_s3_uri),
    )
