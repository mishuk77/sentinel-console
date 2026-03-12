from sqlalchemy import Column, String, Float, DateTime, JSON, ForeignKey, Integer
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime
from app.db.base_class import Base

class Decision(Base):
    __tablename__ = "decisions"

    id = Column(String, primary_key=True, default=lambda: str(uuid.uuid4()))
    
    # Inputs
    input_payload = Column(JSON, nullable=False)
    applicant_name = Column(String, nullable=True)
    applicant_ssn = Column(String, nullable=True) # In production, this must be encrypted
    
    # Metadata
    model_version_id = Column(String, ForeignKey("models.id"), nullable=True)
    policy_version_id = Column(String, ForeignKey("policies.id"), nullable=True)
    
    # Outputs
    score = Column(Float, nullable=True)
    decision = Column(String, nullable=False) # APPROVE / DECLINE
    reason_codes = Column(JSON, nullable=True)
    
    # Loan Amount Audit
    metric_decile = Column(Integer, nullable=True)
    allowed_amount = Column(Float, nullable=True)
    approved_amount = Column(Float, nullable=True)

    # Fraud Assessment
    fraud_score = Column(Float, nullable=True)
    fraud_tier = Column(String, nullable=True)
    fraud_action = Column(String, nullable=True)
    fraud_model_id = Column(String, nullable=True)

    # Adverse Action (SHAP)
    adverse_action_factors = Column(JSON, nullable=True)
    
    timestamp = Column(DateTime, default=datetime.utcnow)

    model = relationship("MLModel")
    policy = relationship("Policy")

    decision_system_id = Column(String, ForeignKey("decision_systems.id"), nullable=True)
    decision_system = relationship("DecisionSystem", back_populates="decisions")
