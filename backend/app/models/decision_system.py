from sqlalchemy import Column, String, DateTime, Text
from sqlalchemy.sql import func
from app.db.session import Base
import uuid


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

    # Active pointers (foreign keys to be added when those tables exist)
    active_model_id = Column(String(50), nullable=True)
    active_policy_id = Column(String(50), nullable=True)
