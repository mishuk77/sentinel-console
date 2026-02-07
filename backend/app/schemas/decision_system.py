from pydantic import BaseModel, Field, field_validator
from datetime import datetime
from typing import Optional, Literal

SystemModule = Literal[
    "credit_scoring",
    "policy_engine",
    "fraud_detection",
    "exposure_control",
]

MODULE_DEPENDENCIES: dict[str, list[str]] = {
    "credit_scoring": [],
    "policy_engine": ["credit_scoring"],
    "fraud_detection": [],
    "exposure_control": ["policy_engine"],
}


class DecisionSystemBase(BaseModel):
    """Base schema for DecisionSystem."""

    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None


class DecisionSystemCreate(DecisionSystemBase):
    """Schema for creating a DecisionSystem."""

    enabled_modules: list[SystemModule] = ["credit_scoring", "policy_engine"]

    @field_validator("enabled_modules")
    @classmethod
    def validate_modules(cls, v: list[str]) -> list[str]:
        if not v:
            raise ValueError("At least one module must be enabled")
        for mod in v:
            for dep in MODULE_DEPENDENCIES.get(mod, []):
                if dep not in v:
                    raise ValueError(
                        f"Module '{mod}' requires '{dep}' to be enabled"
                    )
        return v


class DecisionSystemUpdate(BaseModel):
    """Schema for updating a DecisionSystem."""

    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    enabled_modules: Optional[list[SystemModule]] = None

    @field_validator("enabled_modules")
    @classmethod
    def validate_modules(cls, v: list[str] | None) -> list[str] | None:
        if v is None:
            return v
        if not v:
            raise ValueError("At least one module must be enabled")
        for mod in v:
            for dep in MODULE_DEPENDENCIES.get(mod, []):
                if dep not in v:
                    raise ValueError(
                        f"Module '{mod}' requires '{dep}' to be enabled"
                    )
        return v


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
    enabled_modules: list[str] = []
    active_model_id: Optional[str] = None
    active_policy_id: Optional[str] = None
    active_model_summary: Optional[ActiveModelSummary] = None
    active_policy_summary: Optional[ActivePolicySummary] = None

    class Config:
        from_attributes = True
