from sqlalchemy import Column, String, Enum, DateTime, JSON, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import datetime
import enum
from app.db.base_class import Base

class DatasetStatus(str, enum.Enum):
    PENDING = "PENDING"
    VALID = "VALID"
    INVALID = "INVALID"

class Dataset(Base):
    __tablename__ = "datasets"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    s3_key = Column(String, nullable=False)
    status = Column(Enum(DatasetStatus), default=DatasetStatus.PENDING)
    metadata_info = Column(JSON, nullable=True) # "metadata" is reserved word often
    module_type = Column(String, nullable=True)  # "credit_scoring", "fraud_detection", etc.
    created_at = Column(DateTime, default=datetime.utcnow)

    # TASK-6: identifies the column carrying the principal/approved amount.
    # Used for Mode 2 loss assumption (full principal at risk on default)
    # AND for predicted-loss math (approved_amount × predicted_probability).
    approved_amount_column = Column(String, nullable=True)

    # TASK-6: identifies the column carrying actual dollar loss when the bad
    # event occurred (e.g., charge_off_amount). Used for Mode 1 — when set,
    # it overrides the Mode 2 full-principal assumption.
    loss_amount_column = Column(String, nullable=True)

    # TASK-11G: the canonical applicant identifier. Used by the "what
    # changed" diff view to surface specific applications that crossed a
    # decision boundary. Falls back to row index in UI when None.
    id_column = Column(String, nullable=True)

    # TASK-11F: list of column names the user has tagged as breakout
    # dimensions (e.g., ["channel", "product_type", "state"]). These are
    # available as segment breakouts on every aggregate view even when no
    # segmentation policy is defined for them.
    segmenting_dimensions = Column(JSON, nullable=True)

    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True) # Check if we want nullable=False? For new ones yes.
    decision_system = relationship("DecisionSystem", back_populates="datasets")

    models = relationship("MLModel", back_populates="dataset", cascade="all, delete-orphan")
