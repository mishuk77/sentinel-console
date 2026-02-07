from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.dialects.postgresql import ARRAY
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid


VALID_MODULES = {"credit_scoring", "policy_engine", "fraud_detection", "exposure_control"}
DEFAULT_MODULES = ["credit_scoring", "policy_engine"]


def generate_uuid():
    return f"sys_{uuid.uuid4().hex[:12]}"


class DecisionSystem(Base):
    """Decision System model - the top-level workspace for ML models and policies."""

    __tablename__ = "decision_systems"

    id = Column(String(50), primary_key=True, default=generate_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Enabled modules
    enabled_modules = Column(
        ARRAY(String(50)),
        nullable=False,
        default=DEFAULT_MODULES,
        server_default="{credit_scoring,policy_engine}",
    )

    # Active pointers (foreign keys to be added when those tables exist)
    active_model_id = Column(String(50), nullable=True)
    active_policy_id = Column(String(50), nullable=True)

    # Relationships
    ml_models = relationship("MLModel", back_populates="decision_system", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="decision_system", cascade="all, delete-orphan")
    exposure_limits = relationship("ExposureLimit", back_populates="decision_system", cascade="all, delete-orphan")
    audit_logs = relationship("AuditLog", back_populates="decision_system", cascade="all, delete-orphan")
