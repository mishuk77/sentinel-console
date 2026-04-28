from sqlalchemy import Column, String, Enum, DateTime, JSON, ForeignKey, Float
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
import enum
from app.db.base_class import Base

class ModelStatus(str, enum.Enum):
    TRAINING = "TRAINING"
    CANDIDATE = "CANDIDATE"
    ACTIVE = "ACTIVE"
    ARCHIVED = "ARCHIVED"
    FAILED = "FAILED"

class MLModel(Base):
    __tablename__ = "models"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    dataset_id = Column(String, ForeignKey("datasets.id"), nullable=False)
    name = Column(String, nullable=True) # e.g. "XGBoost_v1"
    algorithm = Column(String, nullable=True) # "xgboost", "random_forest"
    status = Column(Enum(ModelStatus), default=ModelStatus.TRAINING)
    metrics = Column(JSON, nullable=True)
    artifact_path = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    # TASK-6: explicit target column (the dependent variable the user picked
    # at modeling time). Canonical reference for "what is the bad event"
    # everywhere downstream — calibration, backtest, simulation, drift.
    target_column = Column(String, nullable=True)

    # TASK-6: optional loss-amount column for Mode 1. When set, the column is
    # the dollar amount lost on the bad event (vs. assuming full principal).
    loss_amount_column = Column(String, nullable=True)

    # TASK-10 Layer 1: health check status set by training.
    # PASS / WARN / FAIL — FAIL prevents the artifact from being saved.
    health_status = Column(String, nullable=True)
    health_report = Column(JSON, nullable=True)

    # TASK-10 Layer 3 H6: prediction distribution baseline captured at
    # registration time. Stored as a list of quantile values (10 buckets,
    # P5/P15/.../P95) — compact representation that's enough for KS-based
    # drift detection without storing the full prediction array.
    # Fixed at registration; does NOT shift over time. If the population
    # genuinely changes, the user retrains + re-registers, which captures
    # a new baseline.
    distribution_baseline = Column(JSON, nullable=True)

    dataset = relationship("Dataset", back_populates="models")

    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    decision_system = relationship("DecisionSystem", back_populates="models")
