from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum, Integer
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid
import enum


class PolicyStatus(str, enum.Enum):
    DRAFT = "draft"
    ACTIVE = "active"
    INACTIVE = "inactive"
    ARCHIVED = "archived"


def generate_policy_uuid():
    return f"pol_{uuid.uuid4().hex[:12]}"


class Policy(Base):
    """Policy rules for the policy engine module."""

    __tablename__ = "policies"

    id = Column(String(50), primary_key=True, default=generate_policy_uuid)
    system_id = Column(String(50), ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    # Policy rules stored as JSON
    rules = Column(JSONB, nullable=False, default=list)

    # Priority for rule evaluation order (lower = higher priority)
    priority = Column(Integer, nullable=False, default=100)

    status = Column(Enum(PolicyStatus), nullable=False, default=PolicyStatus.DRAFT)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship
    decision_system = relationship("DecisionSystem", back_populates="policies")
