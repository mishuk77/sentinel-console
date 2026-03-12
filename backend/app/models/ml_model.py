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

    dataset = relationship("Dataset", back_populates="models")
    
    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    decision_system = relationship("DecisionSystem", back_populates="models")
