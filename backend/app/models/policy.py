from sqlalchemy import Column, String, Float, Boolean, DateTime, ForeignKey, Integer, JSON
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.db.base_class import Base

class Policy(Base):
    __tablename__ = "policies"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    model_id = Column(String, ForeignKey("models.id"), nullable=False)
    threshold = Column(Float, nullable=False)
    projected_approval_rate = Column(Float, nullable=True)
    projected_loss_rate = Column(Float, nullable=True)
    target_decile = Column(Integer, nullable=True)
    amount_ladder = Column(JSON, nullable=True)
    is_active = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    model = relationship("MLModel")
    
    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    decision_system = relationship("DecisionSystem", back_populates="policies")
