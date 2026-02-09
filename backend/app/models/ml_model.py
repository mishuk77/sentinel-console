from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid
import enum


class ModelStatus(str, enum.Enum):
    DRAFT = "draft"
    TRAINING = "training"
    VALIDATING = "validating"
    ACTIVE = "active"
    ARCHIVED = "archived"


class ModuleType(str, enum.Enum):
    CREDIT_SCORING = "credit_scoring"
    FRAUD_DETECTION = "fraud_detection"


def generate_model_uuid():
    return f"mdl_{uuid.uuid4().hex[:12]}"


class MLModel(Base):
    """ML Model for credit scoring and fraud detection modules."""

    __tablename__ = "ml_models"

    id = Column(String(50), primary_key=True, default=generate_model_uuid)
    system_id = Column(String(50), ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    module_type = Column(Enum(ModuleType), nullable=False)
    version = Column(String(50), nullable=False, default="1.0.0")
    status = Column(Enum(ModelStatus), nullable=False, default=ModelStatus.DRAFT)

    # Model configuration stored as path or reference
    model_artifact_path = Column(String(500), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship
    decision_system = relationship("DecisionSystem", back_populates="ml_models")
