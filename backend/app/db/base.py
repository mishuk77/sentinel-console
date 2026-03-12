# Import all models here for Alembic autogenerate
from app.db.base_class import Base
from app.models.client import Client
from app.models.user import User
from app.models.decision_system import DecisionSystem
from app.models.dataset import Dataset, DatasetStatus
from app.models.ml_model import MLModel, ModelStatus
from app.models.policy import Policy
from app.models.policy_segment import PolicySegment
from app.models.decision import Decision
from app.models.fraud import (
    FraudCase, FraudSignal, VerificationRequest,
    FraudRule, FraudRuleCondition, FraudModel,
    SignalProvider, FraudAutomationSettings
)
