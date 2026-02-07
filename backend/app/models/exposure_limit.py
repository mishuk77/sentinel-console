from sqlalchemy import Column, String, DateTime, Text, ForeignKey, Enum, Numeric
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.session import Base
import uuid
import enum


class LimitStatus(str, enum.Enum):
    ACTIVE = "active"
    BREACHED = "breached"
    WARNING = "warning"
    INACTIVE = "inactive"


class LimitType(str, enum.Enum):
    PORTFOLIO = "portfolio"
    SEGMENT = "segment"
    INDIVIDUAL = "individual"
    DAILY = "daily"
    MONTHLY = "monthly"


def generate_limit_uuid():
    return f"lim_{uuid.uuid4().hex[:12]}"


class ExposureLimit(Base):
    """Exposure limits for risk control module."""

    __tablename__ = "exposure_limits"

    id = Column(String(50), primary_key=True, default=generate_limit_uuid)
    system_id = Column(String(50), ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)

    limit_type = Column(Enum(LimitType), nullable=False)

    # Threshold and current values
    threshold = Column(Numeric(precision=18, scale=2), nullable=False)
    current_value = Column(Numeric(precision=18, scale=2), nullable=False, default=0)
    warning_threshold_pct = Column(Numeric(precision=5, scale=2), nullable=False, default=80.00)

    status = Column(Enum(LimitStatus), nullable=False, default=LimitStatus.ACTIVE)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    # Relationship
    decision_system = relationship("DecisionSystem", back_populates="exposure_limits")
