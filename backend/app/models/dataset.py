from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Integer, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid
import enum


class DatasetStatus(str, enum.Enum):
    PENDING = "PENDING"
    VALID = "VALID"
    INVALID = "INVALID"


def generate_dataset_uuid():
    return f"ds_{uuid.uuid4().hex[:12]}"


class Dataset(Base):
    """Dataset model for uploaded CSV files."""

    __tablename__ = "datasets"

    id = Column(String(50), primary_key=True, default=generate_dataset_uuid)
    decision_system_id = Column(String(50), ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)

    # File info
    filename = Column(String(255), nullable=False)
    s3_key = Column(String(500), nullable=True)  # For cloud storage
    file_path = Column(Text, nullable=True)  # Local path or URL

    # Status
    status = Column(Enum(DatasetStatus), default=DatasetStatus.PENDING, nullable=False)

    # Metadata
    row_count = Column(Integer, nullable=True)
    column_count = Column(Integer, nullable=True)
    columns = Column(JSONB, nullable=True)  # List of column names
    metadata_info = Column(JSONB, nullable=True)  # Additional metadata

    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship
    decision_system = relationship("DecisionSystem", back_populates="datasets")
