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

    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True) # Check if we want nullable=False? For new ones yes.
    decision_system = relationship("DecisionSystem", back_populates="datasets")

    models = relationship("MLModel", back_populates="dataset", cascade="all, delete-orphan")
