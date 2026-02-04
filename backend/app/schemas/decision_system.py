from pydantic import BaseModel, Field
from datetime import datetime
from typing import Optional


class DecisionSystemBase(BaseModel):
    """Base schema for DecisionSystem."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class DecisionSystemCreate(DecisionSystemBase):
    """Schema for creating a DecisionSystem."""

    pass


class DecisionSystemUpdate(BaseModel):
    """Schema for updating a DecisionSystem."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None


class ActiveModelSummary(BaseModel):
    """Summary of the active model."""

    id: str
    name: str
    algorithm: str
    auc: float


class ActivePolicySummary(BaseModel):
    """Summary of the active policy."""

    name: str
    target_decile: Optional[int] = None
    threshold: float
    approval_rate: float


class DecisionSystemResponse(DecisionSystemBase):
    """Schema for DecisionSystem response."""

    id: str
    created_at: datetime
    active_model_id: Optional[str] = None
    active_policy_id: Optional[str] = None
    active_model_summary: Optional[ActiveModelSummary] = None
    active_policy_summary: Optional[ActivePolicySummary] = None

    class Config:
        from_attributes = True
