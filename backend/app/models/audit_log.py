from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid
import enum


class AuditAction(str, enum.Enum):
    CREATE = "create"
    UPDATE = "update"
    DELETE = "delete"
    ACTIVATE = "activate"
    DEACTIVATE = "deactivate"
    DECISION = "decision"


class EntityType(str, enum.Enum):
    SYSTEM = "system"
    MODEL = "model"
    POLICY = "policy"
    EXPOSURE_LIMIT = "exposure_limit"


def generate_audit_uuid():
    return f"aud_{uuid.uuid4().hex[:12]}"


class AuditLog(Base):
    """Audit log for tracking all changes and decisions."""

    __tablename__ = "audit_logs"

    id = Column(String(50), primary_key=True, default=generate_audit_uuid)
    system_id = Column(String(50), ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)

    action = Column(Enum(AuditAction), nullable=False)
    entity_type = Column(Enum(EntityType), nullable=False)
    entity_id = Column(String(50), nullable=True)

    # Details of the change/decision
    details = Column(JSONB, nullable=True)

    # Optional user tracking
    user_id = Column(String(100), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationship
    decision_system = relationship("DecisionSystem", back_populates="audit_logs")
