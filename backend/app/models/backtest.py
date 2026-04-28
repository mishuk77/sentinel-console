"""
Backtest persistence — TASK-8 + TASK-11D.

Two tables:
    backtest_runs       Run metadata: snapshots, summary stats, S3 pointer
    backtest_results    First 1000 rows for fast drill-down (full results
                        in S3 Parquet)

Determinism + reproducibility (TASK-11D):
  - policy_snapshot is captured at run start so the run reflects the
    exact configuration in effect when it ran, even if the policy is
    later edited.
  - model_artifact_path is pinned (it embeds version_id from training).
  - dataset_content_hash is captured so we can detect dataset
    modifications.
  - Re-rendering an existing backtest reads from the persisted snapshot,
    never from the live policy.
"""
from sqlalchemy import Column, String, Float, Integer, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime
import uuid

from app.db.base_class import Base


class BacktestRun(Base):
    __tablename__ = "backtest_runs"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    dataset_id = Column(String, ForeignKey("datasets.id"), nullable=True)
    model_id = Column(String, ForeignKey("models.id"), nullable=True)
    policy_id = Column(String, ForeignKey("policies.id"), nullable=True)

    # Snapshots — TASK-11D reproducibility
    policy_snapshot = Column(JSON, nullable=True)
    model_artifact_path = Column(String, nullable=True)  # pinned, embeds version_id
    dataset_content_hash = Column(String, nullable=True)
    dataset_filename = Column(String, nullable=True)
    dataset_row_count = Column(Integer, nullable=True)

    # Run lifecycle
    status = Column(String, default="pending")  # pending | running | completed | failed
    started_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)
    error_message = Column(String, nullable=True)
    started_by = Column(String, nullable=True)  # user email
    engine_version = Column(String, nullable=True)

    # Summary stats (the same metrics StageMetrics produces, applied to
    # the full run output)
    rows_processed = Column(Integer, default=0)
    rows_errors = Column(Integer, default=0)
    rows_warnings = Column(Integer, default=0)
    avg_latency_ms = Column(Float, nullable=True)

    # Decision distribution
    n_approved = Column(Integer, default=0)
    n_denied = Column(Integer, default=0)
    n_review = Column(Integer, default=0)
    total_approved_dollars = Column(Float, nullable=True)
    total_predicted_loss_dollars = Column(Float, nullable=True)

    # Calibration metrics (when outcomes are available)
    has_outcomes = Column(Integer, default=0)  # 1 if outcomes were available
    auc = Column(Float, nullable=True)
    ks_statistic = Column(Float, nullable=True)
    brier_score = Column(Float, nullable=True)
    brier_skill_score = Column(Float, nullable=True)
    calibration_error_pp = Column(Float, nullable=True)

    # Storage pointer for full results (Parquet on S3 — Mode 8 hybrid)
    parquet_s3_uri = Column(String, nullable=True)

    # Sample of detailed results stored inline (first 1000 rows)
    sample_results = Column(JSON, nullable=True)


class BacktestRowResult(Base):
    """First 1000 row-level results stored in DB for fast drill-down.

    Beyond row 1000, the UI hits the parquet S3 file (out of scope for
    this MVP — rows 1-1000 are sufficient for spot-checking)."""

    __tablename__ = "backtest_row_results"

    id = Column(Integer, primary_key=True, autoincrement=True)
    backtest_run_id = Column(String, ForeignKey("backtest_runs.id", ondelete="CASCADE"), nullable=False)
    row_index = Column(Integer, nullable=False)

    application_id = Column(String, nullable=True)
    score = Column(Float, nullable=True)
    decision = Column(String, nullable=True)  # approve | approve_with_conditions | deny
    approved_amount = Column(Float, nullable=True)
    matched_segment = Column(String, nullable=True)
    actual_outcome = Column(Integer, nullable=True)  # 0 / 1 / null when unavailable
    error_message = Column(String, nullable=True)  # for hard error rows
    warning_flags = Column(JSON, nullable=True)  # soft warnings (out-of-range etc.)

    # Storing SHAP top-3 here to make drill-down fast without recomputing
    shap_top_features = Column(JSON, nullable=True)
