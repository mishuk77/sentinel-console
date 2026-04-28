from sqlalchemy import Column, String, DateTime, Boolean, ForeignKey
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.db.base_class import Base

class DecisionSystem(Base):
    __tablename__ = "decision_systems"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    name = Column(String, nullable=False)
    description = Column(String, nullable=True)
    system_type = Column(String, default="full")  # "credit" | "fraud" | "full"
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # tenant isolation
    client_id = Column(String, ForeignKey("clients.id"), nullable=True) # Nullable for migration, will require later
    
    # Active References
    active_model_id = Column(String, nullable=True)
    active_fraud_model_id = Column(String, nullable=True)
    active_policy_id = Column(String, nullable=True)

    # TASK-10 Layer 3: status from the most recent runtime health monitor
    # tick. healthy | warning | degraded. Updated by the Celery beat task
    # in app.workers.inference_health_monitor.
    runtime_health_status = Column(String, nullable=True)

    # Relationships
    datasets = relationship("Dataset", back_populates="decision_system", cascade="all, delete-orphan")
    models = relationship("MLModel", back_populates="decision_system", cascade="all, delete-orphan")
    policies = relationship("Policy", back_populates="decision_system", cascade="all, delete-orphan")
    decisions = relationship("Decision", back_populates="decision_system", cascade="all, delete-orphan")

    @property
    def active_model_summary(self):
        return None  # Or implement logic to fetch from self.models if loaded

    @property
    def active_policy_summary(self):
        return None
