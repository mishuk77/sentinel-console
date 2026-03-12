import uuid
from datetime import datetime
from sqlalchemy import Column, String, Float, Integer, Boolean, DateTime, JSON, ForeignKey
from app.db.base_class import Base


class PolicySegment(Base):
    __tablename__ = "policy_segments"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    policy_id = Column(String, ForeignKey("policies.id", ondelete="CASCADE"), nullable=False)
    name = Column(String, nullable=False)
    filters = Column(JSON, nullable=False, default=dict)   # {} = Global segment
    specificity = Column(Integer, nullable=False, default=0)  # len(filters)
    threshold = Column(Float, nullable=True)               # AI/system derived
    override_threshold = Column(Float, nullable=True)      # Manual analyst override
    override_reason = Column(String, nullable=True)
    override_by = Column(String, nullable=True)
    n_samples = Column(Integer, nullable=True)
    default_rate = Column(Float, nullable=True)            # fraction 0-1
    confidence_score = Column(Float, nullable=True)        # 0.0-1.0
    confidence_tier = Column(String, nullable=True)        # "green" / "yellow" / "red"
    projected_approval_rate = Column(Float, nullable=True) # fraction 0-1 at current threshold
    fallback_segment_id = Column(String, nullable=True)    # ID of fallback segment
    is_global = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
