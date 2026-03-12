"""
Fraud Management Module - Database Models
Implements: FraudCase, FraudSignal, VerificationRequest, FraudRule,
            FraudRuleCondition, FraudModel, SignalProvider, FraudAutomationSettings
"""
from sqlalchemy import (
    Column, String, Integer, Float, Boolean, DateTime, Text,
    ForeignKey, JSON, ARRAY, CheckConstraint, Index
)
from sqlalchemy.orm import relationship
import uuid
from datetime import datetime, timedelta
from app.db.base_class import Base


# ============ Enums as String Constraints ============

FRAUD_CASE_STATUS = ("pending", "in_review", "verification_pending", "decided", "escalated")
FRAUD_RISK_LEVEL = ("critical", "high", "medium", "low")
FRAUD_DECISION = ("approved", "declined", "escalated")
VERIFICATION_TYPE = ("otp_sms", "otp_email", "kba", "document_upload", "video_call", "manual_call")
VERIFICATION_STATUS = ("pending", "sent", "completed", "expired", "failed")
VERIFICATION_RESULT = ("passed", "failed", "inconclusive")
RULE_OPERATOR = ("equals", "not_equals", "greater_than", "less_than",
                 "contains", "not_contains", "in", "not_in", "is_true", "is_false")
RULE_ACTION = ("flag_for_review", "auto_decline", "require_verification",
               "adjust_score", "set_queue", "escalate")
FRAUD_MODEL_ALGORITHM = ("gradient_boosting", "random_forest", "neural_network", "ensemble")
FRAUD_MODEL_STATUS = ("training", "validating", "ready", "active", "archived", "failed")
SIGNAL_PROVIDER_TYPE = ("identity", "device", "behavioral", "consortium", "bureau")
SIGNAL_PROVIDER_STATUS = ("connected", "disconnected", "error", "rate_limited")
ASSIGNMENT_STRATEGY = ("round_robin", "load_balanced", "skill_based")


# SLA targets in minutes by queue level
SLA_TARGETS = {
    "critical": 15,
    "high": 60,
    "medium": 240,
    "low": 1440
}


def calculate_sla_deadline(queue_level: str, created_at: datetime = None) -> datetime:
    """Calculate SLA deadline based on queue level"""
    if created_at is None:
        created_at = datetime.utcnow()
    minutes = SLA_TARGETS.get(queue_level, 1440)
    return created_at + timedelta(minutes=minutes)


def score_to_risk_level(score: int) -> str:
    """Convert fraud score (0-1000) to risk level"""
    if score >= 800:
        return "critical"
    elif score >= 600:
        return "high"
    elif score >= 400:
        return "medium"
    return "low"


# ============ Fraud Case ============

class FraudCase(Base):
    __tablename__ = "fraud_cases"

    id = Column(String(50), primary_key=True, default=lambda: f"case_{uuid.uuid4().hex[:12]}")
    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    application_id = Column(String(50), nullable=False)
    applicant_name = Column(String(255), nullable=False)
    applicant_email = Column(String(255), nullable=False)

    # Score components (stored denormalized for performance)
    total_score = Column(Integer, nullable=False)
    risk_level = Column(String(20), nullable=False)
    identity_score = Column(Integer, default=0)
    device_score = Column(Integer, default=0)
    velocity_score = Column(Integer, default=0)
    behavioral_score = Column(Integer, default=0)
    score_model_version = Column(String(50), nullable=True)
    score_calculated_at = Column(DateTime, default=datetime.utcnow)

    # Case management
    status = Column(String(30), nullable=False, default="pending")
    queue_level = Column(String(20), nullable=False)
    assigned_analyst_id = Column(String, ForeignKey("users.id"), nullable=True)
    sla_deadline = Column(DateTime(timezone=True), nullable=False)

    # Decision
    decision = Column(String(20), nullable=True)
    decision_reason = Column(Text, nullable=True)
    decided_by = Column(String, ForeignKey("users.id"), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    # Relationships
    decision_system = relationship("DecisionSystem")
    assigned_analyst = relationship("User", foreign_keys=[assigned_analyst_id])
    decided_by_user = relationship("User", foreign_keys=[decided_by])
    signals = relationship("FraudSignal", back_populates="case", cascade="all, delete-orphan")
    verification_requests = relationship("VerificationRequest", back_populates="case", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(f"status IN {FRAUD_CASE_STATUS}", name="check_fraud_case_status"),
        CheckConstraint(f"risk_level IN {FRAUD_RISK_LEVEL}", name="check_fraud_risk_level"),
        CheckConstraint(f"queue_level IN {FRAUD_RISK_LEVEL}", name="check_fraud_queue_level"),
        CheckConstraint("total_score >= 0 AND total_score <= 1000", name="check_fraud_score_range"),
        Index("idx_fraud_cases_system", "decision_system_id"),
        Index("idx_fraud_cases_status", "status"),
        Index("idx_fraud_cases_queue", "queue_level"),
        Index("idx_fraud_cases_analyst", "assigned_analyst_id"),
        Index("idx_fraud_cases_sla", "sla_deadline"),
    )

    @property
    def score(self):
        """Return composite score object for API response"""
        return {
            "total_score": self.total_score,
            "risk_level": self.risk_level,
            "model_version": self.score_model_version,
            "calculated_at": self.score_calculated_at.isoformat() if self.score_calculated_at else None,
            "component_scores": {
                "identity_score": self.identity_score,
                "device_score": self.device_score,
                "velocity_score": self.velocity_score,
                "behavioral_score": self.behavioral_score
            }
        }


# ============ Fraud Signal ============

class FraudSignal(Base):
    __tablename__ = "fraud_signals"

    id = Column(String(50), primary_key=True, default=lambda: f"sig_{uuid.uuid4().hex[:12]}")
    case_id = Column(String(50), ForeignKey("fraud_cases.id", ondelete="CASCADE"), nullable=False)
    signal_type = Column(String(30), nullable=False)  # device, velocity, identity, behavioral
    signal_name = Column(String(100), nullable=False)
    description = Column(Text, nullable=True)
    raw_value = Column(Text, nullable=True)
    risk_contribution = Column(Integer, nullable=False)  # 0-100
    triggered_at = Column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    case = relationship("FraudCase", back_populates="signals")

    __table_args__ = (
        CheckConstraint("risk_contribution >= 0 AND risk_contribution <= 100", name="check_signal_contribution"),
        Index("idx_fraud_signals_case", "case_id"),
    )


# ============ Verification Request ============

class VerificationRequest(Base):
    __tablename__ = "verification_requests"

    id = Column(String(50), primary_key=True, default=lambda: f"ver_{uuid.uuid4().hex[:12]}")
    case_id = Column(String(50), ForeignKey("fraud_cases.id", ondelete="CASCADE"), nullable=False)
    verification_type = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, default="pending")
    requested_by = Column(String, ForeignKey("users.id"), nullable=False)
    requested_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    completed_at = Column(DateTime(timezone=True), nullable=True)
    result = Column(String(20), nullable=True)
    result_details = Column(Text, nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)

    case = relationship("FraudCase", back_populates="verification_requests")
    requester = relationship("User")

    __table_args__ = (
        CheckConstraint(f"verification_type IN {VERIFICATION_TYPE}", name="check_verification_type"),
        CheckConstraint(f"status IN {VERIFICATION_STATUS}", name="check_verification_status"),
        Index("idx_verifications_case", "case_id"),
        Index("idx_verifications_status", "status"),
    )


# ============ Fraud Rule ============

class FraudRule(Base):
    __tablename__ = "fraud_rules"

    id = Column(String(50), primary_key=True, default=lambda: f"rule_{uuid.uuid4().hex[:12]}")
    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_active = Column(Boolean, default=True)
    priority = Column(Integer, nullable=False, default=100)  # Lower = higher priority
    condition_logic = Column(String(10), nullable=False, default="AND")  # AND or OR
    action = Column(String(30), nullable=False)
    action_config = Column(JSON, nullable=True)  # score_adjustment, queue_level, verification_type
    trigger_count = Column(Integer, default=0)
    last_triggered_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)
    created_by = Column(String, ForeignKey("users.id"), nullable=False)

    decision_system = relationship("DecisionSystem")
    creator = relationship("User")
    conditions = relationship("FraudRuleCondition", back_populates="rule", cascade="all, delete-orphan")

    __table_args__ = (
        CheckConstraint(f"action IN {RULE_ACTION}", name="check_rule_action"),
        CheckConstraint("condition_logic IN ('AND', 'OR')", name="check_condition_logic"),
        Index("idx_fraud_rules_system", "decision_system_id"),
        Index("idx_fraud_rules_active", "is_active"),
    )


class FraudRuleCondition(Base):
    __tablename__ = "fraud_rule_conditions"

    id = Column(String(50), primary_key=True, default=lambda: f"cond_{uuid.uuid4().hex[:12]}")
    rule_id = Column(String(50), ForeignKey("fraud_rules.id", ondelete="CASCADE"), nullable=False)
    field = Column(String(100), nullable=False)
    operator = Column(String(30), nullable=False)
    value = Column(JSON, nullable=False)  # Can be string, number, boolean, or array

    rule = relationship("FraudRule", back_populates="conditions")

    __table_args__ = (
        CheckConstraint(f"operator IN {RULE_OPERATOR}", name="check_rule_operator"),
        Index("idx_rule_conditions_rule", "rule_id"),
    )


# ============ Fraud Model (ML) ============

class FraudModel(Base):
    __tablename__ = "fraud_models"

    id = Column(String(50), primary_key=True, default=lambda: f"fm_{uuid.uuid4().hex[:12]}")
    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    algorithm = Column(String(30), nullable=False)
    status = Column(String(20), nullable=False, default="training")
    is_active = Column(Boolean, default=False)
    training_config = Column(JSON, nullable=False)  # features, target_variable, train_test_split, hyperparameters
    metrics = Column(JSON, nullable=True)  # auc, precision, recall, f1_score, etc.
    feature_importance = Column(JSON, nullable=True)  # Array of {feature, importance}
    training_samples = Column(Integer, default=0)
    fraud_samples = Column(Integer, default=0)
    version = Column(String(20), nullable=False)
    artifact_path = Column(String(500), nullable=True)
    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    trained_at = Column(DateTime(timezone=True), nullable=True)

    decision_system = relationship("DecisionSystem")

    __table_args__ = (
        CheckConstraint(f"algorithm IN {FRAUD_MODEL_ALGORITHM}", name="check_fraud_model_algorithm"),
        CheckConstraint(f"status IN {FRAUD_MODEL_STATUS}", name="check_fraud_model_status"),
        Index("idx_fraud_models_system", "decision_system_id"),
        Index("idx_fraud_models_active", "is_active"),
    )


# ============ Signal Provider ============

class SignalProvider(Base):
    __tablename__ = "signal_providers"

    id = Column(String(50), primary_key=True, default=lambda: f"sp_{uuid.uuid4().hex[:12]}")
    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), nullable=False)
    name = Column(String(255), nullable=False)
    provider_type = Column(String(30), nullable=False)
    description = Column(Text, nullable=True)
    status = Column(String(20), nullable=False, default="disconnected")
    is_enabled = Column(Boolean, default=False)
    api_endpoint = Column(String(500), nullable=True)
    signals_provided = Column(JSON, nullable=True)  # Array of signal names
    avg_latency_ms = Column(Integer, default=0)
    success_rate = Column(Float, default=0)  # 0-100
    cost_per_call = Column(Float, default=0)  # USD
    calls_today = Column(Integer, default=0)
    last_sync_at = Column(DateTime(timezone=True), nullable=True)
    config = Column(JSON, nullable=True)  # Provider-specific config (API keys, timeouts, etc.)

    decision_system = relationship("DecisionSystem")

    __table_args__ = (
        CheckConstraint(f"provider_type IN {SIGNAL_PROVIDER_TYPE}", name="check_provider_type"),
        CheckConstraint(f"status IN {SIGNAL_PROVIDER_STATUS}", name="check_provider_status"),
        Index("idx_signal_providers_system", "decision_system_id"),
    )


# ============ Fraud Automation Settings ============

class FraudAutomationSettings(Base):
    __tablename__ = "fraud_automation_settings"

    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), primary_key=True)

    # Auto-assignment
    auto_assign_enabled = Column(Boolean, default=False)
    assignment_strategy = Column(String(20), default="round_robin")
    max_cases_per_analyst = Column(Integer, default=25)

    # Auto-decisioning
    auto_approve_below_score = Column(Integer, default=200)
    auto_decline_above_score = Column(Integer, default=900)
    auto_decision_enabled = Column(Boolean, default=False)

    # Escalation
    escalation_timeout_minutes = Column(Integer, default=60)
    auto_escalate_on_timeout = Column(Boolean, default=True)

    # Notifications
    notify_on_critical = Column(Boolean, default=True)
    notify_on_sla_breach = Column(Boolean, default=True)
    notification_channels = Column(JSON, default=["email"])  # email, slack, webhook

    # Batch operations
    batch_review_enabled = Column(Boolean, default=False)
    batch_size_limit = Column(Integer, default=50)

    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    decision_system = relationship("DecisionSystem")

    __table_args__ = (
        CheckConstraint(f"assignment_strategy IN {ASSIGNMENT_STRATEGY}", name="check_assignment_strategy"),
        CheckConstraint("max_cases_per_analyst >= 1 AND max_cases_per_analyst <= 100", name="check_max_cases"),
        CheckConstraint("escalation_timeout_minutes >= 15 AND escalation_timeout_minutes <= 480", name="check_escalation_timeout"),
        CheckConstraint("auto_approve_below_score < auto_decline_above_score - 50", name="check_score_gap"),
    )


# ============ Fraud Tier Configuration ============

class FraudTierConfig(Base):
    __tablename__ = "fraud_tier_config"

    decision_system_id = Column(String, ForeignKey("decision_systems.id", ondelete="CASCADE"), primary_key=True)

    # Risk tier thresholds (0.0 - 1.0 scale)
    low_max = Column(Float, default=0.3, nullable=False)      # 0.0 - low_max = Low
    medium_max = Column(Float, default=0.6, nullable=False)   # low_max - medium_max = Medium
    high_max = Column(Float, default=0.8, nullable=False)     # medium_max - high_max = High
    # high_max - 1.0 = Critical

    # Dispositions per tier (JSON): { medium_method: "otp"|"kba"|"document" }
    dispositions = Column(JSON, nullable=True)

    # Legacy automation flags (kept for backward compat)
    auto_approve_low = Column(Boolean, default=True)
    auto_block_critical = Column(Boolean, default=False)

    created_at = Column(DateTime(timezone=True), default=datetime.utcnow)
    updated_at = Column(DateTime(timezone=True), default=datetime.utcnow, onupdate=datetime.utcnow)

    decision_system = relationship("DecisionSystem")

    __table_args__ = (
        CheckConstraint("low_max > 0.0 AND low_max < 1.0", name="check_low_max"),
        CheckConstraint("medium_max > low_max AND medium_max < 1.0", name="check_medium_max"),
        CheckConstraint("high_max > medium_max AND high_max < 1.0", name="check_high_max"),
    )
