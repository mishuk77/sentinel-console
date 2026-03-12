"""
Fraud Management API Endpoints

Implements all fraud-related endpoints:
- Fraud Cases (CRUD, decide, assign, escalate)
- Verification Requests
- Fraud Rules (CRUD, simulate)
- Fraud Models (CRUD, train, activate)
- Signal Providers
- Automation Settings
- Analytics
"""
from typing import List, Optional, Any
from datetime import datetime, timedelta
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from pydantic import BaseModel, Field

from app.db.session import SessionLocal
from app.api import deps
from app.models.user import User
from app.models.decision_system import DecisionSystem
from app.models.fraud import (
    FraudCase, FraudSignal, VerificationRequest, FraudRule, FraudRuleCondition,
    FraudModel, SignalProvider, FraudAutomationSettings, FraudTierConfig,
    calculate_sla_deadline, score_to_risk_level
)
from app.services.fraud_service import FraudService, RULE_FIELDS, FRAUD_MODEL_FEATURES


router = APIRouter()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def verify_system_access(db: Session, system_id: str, user: User) -> DecisionSystem:
    """Verify user has access to the decision system"""
    system = db.query(DecisionSystem).filter(
        DecisionSystem.id == system_id,
        DecisionSystem.client_id == user.client_id
    ).first()
    if not system:
        raise HTTPException(status_code=404, detail="Decision System not found")
    return system


# ============ Pydantic Schemas ============

# --- Fraud Score ---
class FraudScoreOut(BaseModel):
    model_config = {"from_attributes": True, "protected_namespaces": ()}

    total_score: int
    risk_level: str
    model_version: Optional[str] = None
    calculated_at: Optional[str] = None
    component_scores: dict


# --- Fraud Signal ---
class FraudSignalCreate(BaseModel):
    signal_type: str
    signal_name: str
    description: Optional[str] = None
    raw_value: Optional[str] = None
    risk_contribution: int = Field(ge=0, le=100)


class FraudSignalOut(BaseModel):
    id: str
    signal_type: str
    signal_name: str
    description: Optional[str] = None
    raw_value: Optional[str] = None
    risk_contribution: int
    triggered_at: datetime

    class Config:
        from_attributes = True


# --- Verification Request ---
class VerificationRequestCreate(BaseModel):
    verification_type: str


class VerificationRequestUpdate(BaseModel):
    status: Optional[str] = None
    result: Optional[str] = None
    result_details: Optional[str] = None


class VerificationRequestOut(BaseModel):
    id: str
    case_id: str
    verification_type: str
    status: str
    requested_by: str
    requested_at: datetime
    completed_at: Optional[datetime] = None
    result: Optional[str] = None
    result_details: Optional[str] = None
    expires_at: datetime

    class Config:
        from_attributes = True


# --- Fraud Case ---
class FraudCaseCreate(BaseModel):
    application_id: str
    applicant_name: str
    applicant_email: str
    signals: List[FraudSignalCreate] = []
    # Optional: provide pre-calculated scores
    total_score: Optional[int] = None
    identity_score: Optional[int] = 0
    device_score: Optional[int] = 0
    velocity_score: Optional[int] = 0
    behavioral_score: Optional[int] = 0


class FraudCaseDecision(BaseModel):
    decision: str  # approved, declined, escalated
    reason: str


class FraudCaseAssign(BaseModel):
    analyst_id: str


class FraudCaseOut(BaseModel):
    id: str
    decision_system_id: str
    application_id: str
    applicant_name: str
    applicant_email: str
    score: FraudScoreOut
    signals: List[FraudSignalOut] = []
    status: str
    queue_level: str
    assigned_analyst_id: Optional[str] = None
    assigned_analyst_name: Optional[str] = None
    sla_deadline: datetime
    decision: Optional[str] = None
    decision_reason: Optional[str] = None
    decided_by: Optional[str] = None
    decided_at: Optional[datetime] = None
    verification_requests: List[VerificationRequestOut] = []
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


class FraudCaseListResponse(BaseModel):
    data: List[FraudCaseOut]
    meta: dict


# --- Fraud Rule ---
class FraudRuleConditionCreate(BaseModel):
    field: str
    operator: str
    value: Any


class FraudRuleConditionOut(BaseModel):
    model_config = {"from_attributes": True}

    id: str
    field: str
    operator: str
    value: Any


class FraudRuleCreate(BaseModel):
    name: str
    description: Optional[str] = None
    priority: int = 100
    conditions: List[FraudRuleConditionCreate]
    condition_logic: str = "AND"
    action: str
    action_config: Optional[dict] = None


class FraudRuleUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    conditions: Optional[List[FraudRuleConditionCreate]] = None
    condition_logic: Optional[str] = None
    action: Optional[str] = None
    action_config: Optional[dict] = None


class FraudRuleOut(BaseModel):
    id: str
    decision_system_id: str
    name: str
    description: Optional[str] = None
    is_active: bool
    priority: int
    conditions: List[FraudRuleConditionOut]
    condition_logic: str
    action: str
    action_config: Optional[dict] = None
    trigger_count: int
    last_triggered_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime
    created_by: str

    class Config:
        from_attributes = True


class RuleSimulateRequest(BaseModel):
    conditions: List[FraudRuleConditionCreate]
    condition_logic: str = "AND"
    sample_size: int = 1000


# --- Fraud Model ---
class FraudModelCreate(BaseModel):
    name: str
    description: Optional[str] = None
    algorithm: str
    training_config: dict


class FraudModelOut(BaseModel):
    id: str
    decision_system_id: str
    name: str
    description: Optional[str] = None
    algorithm: str
    status: str
    is_active: bool
    training_config: dict
    metrics: Optional[dict] = None
    feature_importance: Optional[List[dict]] = None
    training_samples: int
    fraud_samples: int
    version: str
    created_at: datetime
    trained_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Signal Provider ---
class SignalProviderUpdate(BaseModel):
    is_enabled: Optional[bool] = None
    config: Optional[dict] = None


class SignalProviderOut(BaseModel):
    id: str
    decision_system_id: str
    name: str
    provider_type: str
    description: Optional[str] = None
    status: str
    is_enabled: bool
    api_endpoint: Optional[str] = None
    signals_provided: Optional[List[str]] = None
    avg_latency_ms: int
    success_rate: float
    cost_per_call: float
    calls_today: int
    last_sync_at: Optional[datetime] = None

    class Config:
        from_attributes = True


# --- Automation Settings ---
class AutomationSettingsUpdate(BaseModel):
    auto_assign_enabled: Optional[bool] = None
    assignment_strategy: Optional[str] = None
    max_cases_per_analyst: Optional[int] = Field(None, ge=1, le=100)
    auto_approve_below_score: Optional[int] = None
    auto_decline_above_score: Optional[int] = None
    auto_decision_enabled: Optional[bool] = None
    escalation_timeout_minutes: Optional[int] = Field(None, ge=15, le=480)
    auto_escalate_on_timeout: Optional[bool] = None
    notify_on_critical: Optional[bool] = None
    notify_on_sla_breach: Optional[bool] = None
    notification_channels: Optional[List[str]] = None
    batch_review_enabled: Optional[bool] = None
    batch_size_limit: Optional[int] = None


class AutomationSettingsOut(BaseModel):
    decision_system_id: str
    auto_assign_enabled: bool
    assignment_strategy: str
    max_cases_per_analyst: int
    auto_approve_below_score: int
    auto_decline_above_score: int
    auto_decision_enabled: bool
    escalation_timeout_minutes: int
    auto_escalate_on_timeout: bool
    notify_on_critical: bool
    notify_on_sla_breach: bool
    notification_channels: List[str]
    batch_review_enabled: bool
    batch_size_limit: int
    updated_at: datetime

    class Config:
        from_attributes = True


# ============ Fraud Cases Endpoints ============

@router.get("/systems/{system_id}/fraud/cases", response_model=FraudCaseListResponse)
def list_fraud_cases(
    system_id: str,
    status: Optional[str] = None,
    queue_level: Optional[str] = None,
    assigned_analyst_id: Optional[str] = None,
    search: Optional[str] = None,
    sort_by: str = "created_at",
    sort_order: str = "desc",
    page: int = 1,
    per_page: int = 20,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """List fraud cases with filtering and pagination"""
    verify_system_access(db, system_id, current_user)

    query = db.query(FraudCase).filter(FraudCase.decision_system_id == system_id)

    # Filters
    if status:
        query = query.filter(FraudCase.status == status)
    if queue_level:
        query = query.filter(FraudCase.queue_level == queue_level)
    if assigned_analyst_id:
        query = query.filter(FraudCase.assigned_analyst_id == assigned_analyst_id)
    if search:
        query = query.filter(
            (FraudCase.applicant_name.ilike(f"%{search}%")) |
            (FraudCase.applicant_email.ilike(f"%{search}%"))
        )

    # Count total
    total = query.count()

    # Sort
    sort_column = getattr(FraudCase, sort_by, FraudCase.created_at)
    if sort_order == "desc":
        query = query.order_by(sort_column.desc())
    else:
        query = query.order_by(sort_column.asc())

    # Paginate
    per_page = min(per_page, 100)
    offset = (page - 1) * per_page
    cases = query.offset(offset).limit(per_page).all()

    # Build response
    case_list = []
    for case in cases:
        analyst_name = None
        if case.assigned_analyst_id:
            analyst = db.query(User).filter(User.id == case.assigned_analyst_id).first()
            analyst_name = analyst.email if analyst else None

        case_out = FraudCaseOut(
            id=case.id,
            decision_system_id=case.decision_system_id,
            application_id=case.application_id,
            applicant_name=case.applicant_name,
            applicant_email=case.applicant_email,
            score=FraudScoreOut(
                total_score=case.total_score,
                risk_level=case.risk_level,
                model_version=case.score_model_version,
                calculated_at=case.score_calculated_at.isoformat() if case.score_calculated_at else None,
                component_scores={
                    "identity_score": case.identity_score,
                    "device_score": case.device_score,
                    "velocity_score": case.velocity_score,
                    "behavioral_score": case.behavioral_score
                }
            ),
            signals=[FraudSignalOut.model_validate(s) for s in case.signals],
            status=case.status,
            queue_level=case.queue_level,
            assigned_analyst_id=case.assigned_analyst_id,
            assigned_analyst_name=analyst_name,
            sla_deadline=case.sla_deadline,
            decision=case.decision,
            decision_reason=case.decision_reason,
            decided_by=case.decided_by,
            decided_at=case.decided_at,
            verification_requests=[VerificationRequestOut.model_validate(v) for v in case.verification_requests],
            created_at=case.created_at,
            updated_at=case.updated_at
        )
        case_list.append(case_out)

    return FraudCaseListResponse(
        data=case_list,
        meta={
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": (total + per_page - 1) // per_page
        }
    )


@router.post("/systems/{system_id}/fraud/cases", response_model=FraudCaseOut)
def create_fraud_case(
    system_id: str,
    case_in: FraudCaseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new fraud case"""
    verify_system_access(db, system_id, current_user)

    fraud_service = FraudService(db)

    # Calculate score from signals if not provided
    if case_in.total_score is not None:
        total_score = case_in.total_score
        risk_level = score_to_risk_level(total_score)
    else:
        # Create temporary signals for calculation
        temp_signals = []
        for sig in case_in.signals:
            temp_sig = FraudSignal(
                signal_type=sig.signal_type,
                risk_contribution=sig.risk_contribution
            )
            temp_signals.append(temp_sig)

        score_result = fraud_service.calculate_fraud_score(temp_signals)
        total_score = score_result["total_score"]
        risk_level = score_result["risk_level"]

    queue_level = risk_level  # Queue level matches risk level
    sla_deadline = calculate_sla_deadline(queue_level)

    # Create case
    case = FraudCase(
        decision_system_id=system_id,
        application_id=case_in.application_id,
        applicant_name=case_in.applicant_name,
        applicant_email=case_in.applicant_email,
        total_score=total_score,
        risk_level=risk_level,
        identity_score=case_in.identity_score or 0,
        device_score=case_in.device_score or 0,
        velocity_score=case_in.velocity_score or 0,
        behavioral_score=case_in.behavioral_score or 0,
        status="pending",
        queue_level=queue_level,
        sla_deadline=sla_deadline
    )

    db.add(case)
    db.flush()  # Get case ID

    # Create signals
    for sig in case_in.signals:
        signal = FraudSignal(
            case_id=case.id,
            signal_type=sig.signal_type,
            signal_name=sig.signal_name,
            description=sig.description,
            raw_value=sig.raw_value,
            risk_contribution=sig.risk_contribution,
            triggered_at=datetime.utcnow()
        )
        db.add(signal)

    # Check auto-assignment
    settings = db.query(FraudAutomationSettings).filter(
        FraudAutomationSettings.decision_system_id == system_id
    ).first()

    if settings:
        assigned_analyst_id = fraud_service.auto_assign_case(case, settings)
        if assigned_analyst_id:
            case.assigned_analyst_id = assigned_analyst_id
            case.status = "in_review"

        # Check auto-decision
        auto_decision = fraud_service.check_auto_decision(case, settings)
        if auto_decision:
            case.decision = auto_decision
            case.status = "decided"
            case.decided_at = datetime.utcnow()
            case.decision_reason = f"Auto-{auto_decision} by system (score: {total_score})"

    db.commit()
    db.refresh(case)

    # Build response
    analyst_name = None
    if case.assigned_analyst_id:
        analyst = db.query(User).filter(User.id == case.assigned_analyst_id).first()
        analyst_name = analyst.email if analyst else None

    return FraudCaseOut(
        id=case.id,
        decision_system_id=case.decision_system_id,
        application_id=case.application_id,
        applicant_name=case.applicant_name,
        applicant_email=case.applicant_email,
        score=FraudScoreOut(
            total_score=case.total_score,
            risk_level=case.risk_level,
            model_version=case.score_model_version,
            calculated_at=case.score_calculated_at.isoformat() if case.score_calculated_at else None,
            component_scores={
                "identity_score": case.identity_score,
                "device_score": case.device_score,
                "velocity_score": case.velocity_score,
                "behavioral_score": case.behavioral_score
            }
        ),
        signals=[FraudSignalOut.model_validate(s) for s in case.signals],
        status=case.status,
        queue_level=case.queue_level,
        assigned_analyst_id=case.assigned_analyst_id,
        assigned_analyst_name=analyst_name,
        sla_deadline=case.sla_deadline,
        decision=case.decision,
        decision_reason=case.decision_reason,
        decided_by=case.decided_by,
        decided_at=case.decided_at,
        verification_requests=[],
        created_at=case.created_at,
        updated_at=case.updated_at
    )


@router.get("/systems/{system_id}/fraud/cases/{case_id}", response_model=FraudCaseOut)
def get_fraud_case(
    system_id: str,
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get a specific fraud case"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    analyst_name = None
    if case.assigned_analyst_id:
        analyst = db.query(User).filter(User.id == case.assigned_analyst_id).first()
        analyst_name = analyst.email if analyst else None

    return FraudCaseOut(
        id=case.id,
        decision_system_id=case.decision_system_id,
        application_id=case.application_id,
        applicant_name=case.applicant_name,
        applicant_email=case.applicant_email,
        score=FraudScoreOut(
            total_score=case.total_score,
            risk_level=case.risk_level,
            model_version=case.score_model_version,
            calculated_at=case.score_calculated_at.isoformat() if case.score_calculated_at else None,
            component_scores={
                "identity_score": case.identity_score,
                "device_score": case.device_score,
                "velocity_score": case.velocity_score,
                "behavioral_score": case.behavioral_score
            }
        ),
        signals=[FraudSignalOut.model_validate(s) for s in case.signals],
        status=case.status,
        queue_level=case.queue_level,
        assigned_analyst_id=case.assigned_analyst_id,
        assigned_analyst_name=analyst_name,
        sla_deadline=case.sla_deadline,
        decision=case.decision,
        decision_reason=case.decision_reason,
        decided_by=case.decided_by,
        decided_at=case.decided_at,
        verification_requests=[VerificationRequestOut.model_validate(v) for v in case.verification_requests],
        created_at=case.created_at,
        updated_at=case.updated_at
    )


@router.post("/systems/{system_id}/fraud/cases/{case_id}/decide", response_model=FraudCaseOut)
def decide_fraud_case(
    system_id: str,
    case_id: str,
    decision_in: FraudCaseDecision,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Make a decision on a fraud case"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    if case.status == "decided":
        raise HTTPException(status_code=400, detail="Case already decided")

    if decision_in.decision not in ["approved", "declined", "escalated"]:
        raise HTTPException(status_code=400, detail="Invalid decision value")

    case.decision = decision_in.decision
    case.decision_reason = decision_in.reason
    case.decided_by = current_user.id
    case.decided_at = datetime.utcnow()
    case.status = "escalated" if decision_in.decision == "escalated" else "decided"

    db.commit()
    db.refresh(case)

    return get_fraud_case(system_id, case_id, db, current_user)


@router.post("/systems/{system_id}/fraud/cases/{case_id}/assign", response_model=FraudCaseOut)
def assign_fraud_case(
    system_id: str,
    case_id: str,
    assign_in: FraudCaseAssign,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Assign a fraud case to an analyst"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    # Verify analyst exists
    analyst = db.query(User).filter(User.id == assign_in.analyst_id).first()
    if not analyst:
        raise HTTPException(status_code=404, detail="Analyst not found")

    case.assigned_analyst_id = assign_in.analyst_id
    if case.status == "pending":
        case.status = "in_review"

    db.commit()
    db.refresh(case)

    return get_fraud_case(system_id, case_id, db, current_user)


@router.post("/systems/{system_id}/fraud/cases/{case_id}/escalate", response_model=FraudCaseOut)
def escalate_fraud_case(
    system_id: str,
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Escalate a fraud case"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    if case.status == "escalated":
        raise HTTPException(status_code=400, detail="Case already escalated")

    case.status = "escalated"
    case.decision = "escalated"
    case.decision_reason = f"Manually escalated by {current_user.email}"
    case.decided_by = current_user.id
    case.decided_at = datetime.utcnow()

    db.commit()
    db.refresh(case)

    return get_fraud_case(system_id, case_id, db, current_user)


# ============ Verification Requests ============

@router.get("/systems/{system_id}/fraud/cases/{case_id}/verifications", response_model=List[VerificationRequestOut])
def list_verifications(
    system_id: str,
    case_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """List verification requests for a case"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    return [VerificationRequestOut.model_validate(v) for v in case.verification_requests]


@router.post("/systems/{system_id}/fraud/cases/{case_id}/verifications", response_model=VerificationRequestOut)
def create_verification(
    system_id: str,
    case_id: str,
    verification_in: VerificationRequestCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a verification request"""
    verify_system_access(db, system_id, current_user)

    case = db.query(FraudCase).filter(
        FraudCase.id == case_id,
        FraudCase.decision_system_id == system_id
    ).first()

    if not case:
        raise HTTPException(status_code=404, detail="Fraud case not found")

    valid_types = ["otp_sms", "otp_email", "kba", "document_upload", "video_call", "manual_call"]
    if verification_in.verification_type not in valid_types:
        raise HTTPException(status_code=400, detail=f"Invalid verification type. Must be one of: {valid_types}")

    # Set expiration based on type
    expiry_hours = {
        "otp_sms": 0.25,  # 15 minutes
        "otp_email": 1,
        "kba": 1,
        "document_upload": 24,
        "video_call": 48,
        "manual_call": 24
    }
    hours = expiry_hours.get(verification_in.verification_type, 24)

    verification = VerificationRequest(
        case_id=case_id,
        verification_type=verification_in.verification_type,
        status="pending",
        requested_by=current_user.id,
        expires_at=datetime.utcnow() + timedelta(hours=hours)
    )

    db.add(verification)

    # Update case status
    case.status = "verification_pending"

    db.commit()
    db.refresh(verification)

    return VerificationRequestOut.model_validate(verification)


@router.patch("/systems/{system_id}/fraud/cases/{case_id}/verifications/{verification_id}", response_model=VerificationRequestOut)
def update_verification(
    system_id: str,
    case_id: str,
    verification_id: str,
    update_in: VerificationRequestUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update a verification request"""
    verify_system_access(db, system_id, current_user)

    verification = db.query(VerificationRequest).filter(
        VerificationRequest.id == verification_id,
        VerificationRequest.case_id == case_id
    ).first()

    if not verification:
        raise HTTPException(status_code=404, detail="Verification request not found")

    if update_in.status:
        verification.status = update_in.status
    if update_in.result:
        verification.result = update_in.result
        verification.completed_at = datetime.utcnow()
    if update_in.result_details:
        verification.result_details = update_in.result_details

    db.commit()
    db.refresh(verification)

    return VerificationRequestOut.model_validate(verification)


# ============ Fraud Rules ============

@router.get("/systems/{system_id}/fraud/rules", response_model=List[FraudRuleOut])
def list_fraud_rules(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """List fraud rules for a system"""
    verify_system_access(db, system_id, current_user)

    rules = db.query(FraudRule).filter(
        FraudRule.decision_system_id == system_id
    ).order_by(FraudRule.priority).all()

    return [FraudRuleOut(
        id=r.id,
        decision_system_id=r.decision_system_id,
        name=r.name,
        description=r.description,
        is_active=r.is_active,
        priority=r.priority,
        conditions=[FraudRuleConditionOut.model_validate(c) for c in r.conditions],
        condition_logic=r.condition_logic,
        action=r.action,
        action_config=r.action_config,
        trigger_count=r.trigger_count,
        last_triggered_at=r.last_triggered_at,
        created_at=r.created_at,
        updated_at=r.updated_at,
        created_by=r.created_by
    ) for r in rules]


@router.post("/systems/{system_id}/fraud/rules", response_model=FraudRuleOut)
def create_fraud_rule(
    system_id: str,
    rule_in: FraudRuleCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = FraudRule(
        decision_system_id=system_id,
        name=rule_in.name,
        description=rule_in.description,
        priority=rule_in.priority,
        condition_logic=rule_in.condition_logic,
        action=rule_in.action,
        action_config=rule_in.action_config,
        created_by=current_user.id
    )

    db.add(rule)
    db.flush()

    # Create conditions
    for cond in rule_in.conditions:
        condition = FraudRuleCondition(
            rule_id=rule.id,
            field=cond.field,
            operator=cond.operator,
            value=cond.value
        )
        db.add(condition)

    db.commit()
    db.refresh(rule)

    return FraudRuleOut(
        id=rule.id,
        decision_system_id=rule.decision_system_id,
        name=rule.name,
        description=rule.description,
        is_active=rule.is_active,
        priority=rule.priority,
        conditions=[FraudRuleConditionOut.model_validate(c) for c in rule.conditions],
        condition_logic=rule.condition_logic,
        action=rule.action,
        action_config=rule.action_config,
        trigger_count=rule.trigger_count,
        last_triggered_at=rule.last_triggered_at,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
        created_by=rule.created_by
    )


@router.get("/systems/{system_id}/fraud/rules/{rule_id}", response_model=FraudRuleOut)
def get_fraud_rule(
    system_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get a specific fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = db.query(FraudRule).filter(
        FraudRule.id == rule_id,
        FraudRule.decision_system_id == system_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Fraud rule not found")

    return FraudRuleOut(
        id=rule.id,
        decision_system_id=rule.decision_system_id,
        name=rule.name,
        description=rule.description,
        is_active=rule.is_active,
        priority=rule.priority,
        conditions=[FraudRuleConditionOut.model_validate(c) for c in rule.conditions],
        condition_logic=rule.condition_logic,
        action=rule.action,
        action_config=rule.action_config,
        trigger_count=rule.trigger_count,
        last_triggered_at=rule.last_triggered_at,
        created_at=rule.created_at,
        updated_at=rule.updated_at,
        created_by=rule.created_by
    )


@router.put("/systems/{system_id}/fraud/rules/{rule_id}", response_model=FraudRuleOut)
def update_fraud_rule(
    system_id: str,
    rule_id: str,
    rule_in: FraudRuleUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update a fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = db.query(FraudRule).filter(
        FraudRule.id == rule_id,
        FraudRule.decision_system_id == system_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Fraud rule not found")

    if rule_in.name is not None:
        rule.name = rule_in.name
    if rule_in.description is not None:
        rule.description = rule_in.description
    if rule_in.priority is not None:
        rule.priority = rule_in.priority
    if rule_in.condition_logic is not None:
        rule.condition_logic = rule_in.condition_logic
    if rule_in.action is not None:
        rule.action = rule_in.action
    if rule_in.action_config is not None:
        rule.action_config = rule_in.action_config

    if rule_in.conditions is not None:
        # Delete existing conditions
        db.query(FraudRuleCondition).filter(FraudRuleCondition.rule_id == rule_id).delete()

        # Create new conditions
        for cond in rule_in.conditions:
            condition = FraudRuleCondition(
                rule_id=rule.id,
                field=cond.field,
                operator=cond.operator,
                value=cond.value
            )
            db.add(condition)

    db.commit()
    db.refresh(rule)

    return get_fraud_rule(system_id, rule_id, db, current_user)


@router.delete("/systems/{system_id}/fraud/rules/{rule_id}")
def delete_fraud_rule(
    system_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Delete a fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = db.query(FraudRule).filter(
        FraudRule.id == rule_id,
        FraudRule.decision_system_id == system_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Fraud rule not found")

    db.delete(rule)
    db.commit()

    return {"message": "Rule deleted"}


@router.post("/systems/{system_id}/fraud/rules/{rule_id}/activate", response_model=FraudRuleOut)
def activate_fraud_rule(
    system_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Activate a fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = db.query(FraudRule).filter(
        FraudRule.id == rule_id,
        FraudRule.decision_system_id == system_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Fraud rule not found")

    rule.is_active = True
    db.commit()
    db.refresh(rule)

    return get_fraud_rule(system_id, rule_id, db, current_user)


@router.post("/systems/{system_id}/fraud/rules/{rule_id}/deactivate", response_model=FraudRuleOut)
def deactivate_fraud_rule(
    system_id: str,
    rule_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Deactivate a fraud rule"""
    verify_system_access(db, system_id, current_user)

    rule = db.query(FraudRule).filter(
        FraudRule.id == rule_id,
        FraudRule.decision_system_id == system_id
    ).first()

    if not rule:
        raise HTTPException(status_code=404, detail="Fraud rule not found")

    rule.is_active = False
    db.commit()
    db.refresh(rule)

    return get_fraud_rule(system_id, rule_id, db, current_user)


@router.post("/systems/{system_id}/fraud/rules/simulate")
def simulate_fraud_rule(
    system_id: str,
    simulate_in: RuleSimulateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Simulate a rule against historical data"""
    verify_system_access(db, system_id, current_user)

    fraud_service = FraudService(db)

    conditions = [
        {"field": c.field, "operator": c.operator, "value": c.value}
        for c in simulate_in.conditions
    ]

    result = fraud_service.simulate_rule(
        system_id,
        conditions,
        simulate_in.condition_logic,
        simulate_in.sample_size
    )

    return result


# ============ Fraud Models ============

@router.get("/systems/{system_id}/fraud/models", response_model=List[FraudModelOut])
def list_fraud_models(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """List fraud models for a system"""
    verify_system_access(db, system_id, current_user)

    models = db.query(FraudModel).filter(
        FraudModel.decision_system_id == system_id
    ).order_by(FraudModel.created_at.desc()).all()

    return [FraudModelOut.model_validate(m) for m in models]


@router.post("/systems/{system_id}/fraud/models", response_model=FraudModelOut)
def create_fraud_model(
    system_id: str,
    model_in: FraudModelCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new fraud model configuration"""
    verify_system_access(db, system_id, current_user)

    # Generate version
    existing_count = db.query(FraudModel).filter(
        FraudModel.decision_system_id == system_id
    ).count()
    version = f"1.{existing_count}.0"

    model = FraudModel(
        decision_system_id=system_id,
        name=model_in.name,
        description=model_in.description,
        algorithm=model_in.algorithm,
        status="training",
        training_config=model_in.training_config,
        version=version
    )

    db.add(model)
    db.commit()
    db.refresh(model)

    return FraudModelOut.model_validate(model)


@router.get("/systems/{system_id}/fraud/models/{model_id}", response_model=FraudModelOut)
def get_fraud_model(
    system_id: str,
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get a specific fraud model"""
    verify_system_access(db, system_id, current_user)

    model = db.query(FraudModel).filter(
        FraudModel.id == model_id,
        FraudModel.decision_system_id == system_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Fraud model not found")

    return FraudModelOut.model_validate(model)


@router.delete("/systems/{system_id}/fraud/models/{model_id}")
def delete_fraud_model(
    system_id: str,
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Delete a fraud model"""
    verify_system_access(db, system_id, current_user)

    model = db.query(FraudModel).filter(
        FraudModel.id == model_id,
        FraudModel.decision_system_id == system_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Fraud model not found")

    if model.is_active:
        raise HTTPException(status_code=400, detail="Cannot delete active model")

    db.delete(model)
    db.commit()

    return {"message": "Model deleted"}


@router.post("/systems/{system_id}/fraud/models/{model_id}/train")
def train_fraud_model(
    system_id: str,
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Start model training (async operation)"""
    verify_system_access(db, system_id, current_user)

    model = db.query(FraudModel).filter(
        FraudModel.id == model_id,
        FraudModel.decision_system_id == system_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Fraud model not found")

    model.status = "training"
    db.commit()

    # In production, this would trigger an async training job
    # For now, simulate completion
    import time
    # Simulated training completion
    model.status = "ready"
    model.trained_at = datetime.utcnow()
    model.training_samples = 10000
    model.fraud_samples = 500
    model.metrics = {
        "auc": 0.87,
        "precision": 0.82,
        "recall": 0.79,
        "f1_score": 0.80,
        "false_positive_rate": 0.05,
        "detection_rate": 0.79,
        "lift_at_10_percent": 5.2
    }
    model.feature_importance = [
        {"feature": "device_reputation_score", "importance": 18.5},
        {"feature": "ssn_velocity", "importance": 15.2},
        {"feature": "ip_risk_score", "importance": 12.8},
        {"feature": "identity_score", "importance": 11.4},
        {"feature": "form_completion_time", "importance": 9.7}
    ]
    db.commit()

    return {
        "model_id": model.id,
        "status": "training",
        "job_id": f"job_{model.id[:8]}",
        "estimated_completion": (datetime.utcnow() + timedelta(minutes=5)).isoformat()
    }


@router.post("/systems/{system_id}/fraud/models/{model_id}/activate", response_model=FraudModelOut)
def activate_fraud_model(
    system_id: str,
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Activate a fraud model (deactivates current active model)"""
    verify_system_access(db, system_id, current_user)

    model = db.query(FraudModel).filter(
        FraudModel.id == model_id,
        FraudModel.decision_system_id == system_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Fraud model not found")

    if model.status != "ready":
        raise HTTPException(status_code=400, detail="Model must be in 'ready' status to activate")

    # Deactivate current active model
    db.query(FraudModel).filter(
        FraudModel.decision_system_id == system_id,
        FraudModel.is_active == True
    ).update({"is_active": False, "status": "archived"})

    model.is_active = True
    model.status = "active"
    db.commit()
    db.refresh(model)

    return FraudModelOut.model_validate(model)


@router.post("/systems/{system_id}/fraud/models/{model_id}/archive", response_model=FraudModelOut)
def archive_fraud_model(
    system_id: str,
    model_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Archive a fraud model"""
    verify_system_access(db, system_id, current_user)

    model = db.query(FraudModel).filter(
        FraudModel.id == model_id,
        FraudModel.decision_system_id == system_id
    ).first()

    if not model:
        raise HTTPException(status_code=404, detail="Fraud model not found")

    if model.is_active:
        raise HTTPException(status_code=400, detail="Cannot archive active model")

    model.status = "archived"
    db.commit()
    db.refresh(model)

    return FraudModelOut.model_validate(model)


@router.get("/systems/{system_id}/fraud/models/features")
def get_fraud_model_features(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get available features for fraud model training"""
    verify_system_access(db, system_id, current_user)

    return FRAUD_MODEL_FEATURES


# ============ Signal Providers ============

@router.get("/systems/{system_id}/fraud/signals/providers", response_model=List[SignalProviderOut])
def list_signal_providers(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """List signal providers for a system"""
    verify_system_access(db, system_id, current_user)

    providers = db.query(SignalProvider).filter(
        SignalProvider.decision_system_id == system_id
    ).all()

    return [SignalProviderOut.model_validate(p) for p in providers]


@router.get("/systems/{system_id}/fraud/signals/providers/{provider_id}", response_model=SignalProviderOut)
def get_signal_provider(
    system_id: str,
    provider_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get a specific signal provider"""
    verify_system_access(db, system_id, current_user)

    provider = db.query(SignalProvider).filter(
        SignalProvider.id == provider_id,
        SignalProvider.decision_system_id == system_id
    ).first()

    if not provider:
        raise HTTPException(status_code=404, detail="Signal provider not found")

    return SignalProviderOut.model_validate(provider)


@router.patch("/systems/{system_id}/fraud/signals/providers/{provider_id}", response_model=SignalProviderOut)
def update_signal_provider(
    system_id: str,
    provider_id: str,
    update_in: SignalProviderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update a signal provider configuration"""
    verify_system_access(db, system_id, current_user)

    provider = db.query(SignalProvider).filter(
        SignalProvider.id == provider_id,
        SignalProvider.decision_system_id == system_id
    ).first()

    if not provider:
        raise HTTPException(status_code=404, detail="Signal provider not found")

    if update_in.is_enabled is not None:
        provider.is_enabled = update_in.is_enabled
    if update_in.config is not None:
        provider.config = update_in.config

    db.commit()
    db.refresh(provider)

    return SignalProviderOut.model_validate(provider)


@router.post("/systems/{system_id}/fraud/signals/providers/{provider_id}/test")
def test_signal_provider(
    system_id: str,
    provider_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Test a signal provider connection"""
    verify_system_access(db, system_id, current_user)

    provider = db.query(SignalProvider).filter(
        SignalProvider.id == provider_id,
        SignalProvider.decision_system_id == system_id
    ).first()

    if not provider:
        raise HTTPException(status_code=404, detail="Signal provider not found")

    # Simulated test result
    return {
        "success": True,
        "latency_ms": 245,
        "signals_available": provider.signals_provided or [],
        "error": None
    }


@router.post("/systems/{system_id}/fraud/signals/providers/{provider_id}/sync")
def sync_signal_provider(
    system_id: str,
    provider_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Sync a signal provider"""
    verify_system_access(db, system_id, current_user)

    provider = db.query(SignalProvider).filter(
        SignalProvider.id == provider_id,
        SignalProvider.decision_system_id == system_id
    ).first()

    if not provider:
        raise HTTPException(status_code=404, detail="Signal provider not found")

    provider.last_sync_at = datetime.utcnow()
    provider.status = "connected"
    db.commit()

    return {"message": "Provider synced", "last_sync_at": provider.last_sync_at.isoformat()}


# ============ Automation Settings ============

@router.get("/systems/{system_id}/fraud/settings", response_model=AutomationSettingsOut)
def get_automation_settings(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get fraud automation settings"""
    verify_system_access(db, system_id, current_user)

    settings = db.query(FraudAutomationSettings).filter(
        FraudAutomationSettings.decision_system_id == system_id
    ).first()

    if not settings:
        # Create default settings
        settings = FraudAutomationSettings(decision_system_id=system_id)
        db.add(settings)
        db.commit()
        db.refresh(settings)

    return AutomationSettingsOut.model_validate(settings)


@router.put("/systems/{system_id}/fraud/settings", response_model=AutomationSettingsOut)
def update_automation_settings(
    system_id: str,
    settings_in: AutomationSettingsUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update fraud automation settings"""
    verify_system_access(db, system_id, current_user)

    settings = db.query(FraudAutomationSettings).filter(
        FraudAutomationSettings.decision_system_id == system_id
    ).first()

    if not settings:
        settings = FraudAutomationSettings(decision_system_id=system_id)
        db.add(settings)

    # Update fields
    update_data = settings_in.model_dump(exclude_unset=True)
    for field, value in update_data.items():
        setattr(settings, field, value)

    # Validate score gap
    approve_score = settings.auto_approve_below_score
    decline_score = settings.auto_decline_above_score
    if approve_score >= decline_score - 50:
        raise HTTPException(
            status_code=400,
            detail="auto_approve_below_score must be at least 50 points below auto_decline_above_score"
        )

    db.commit()
    db.refresh(settings)

    return AutomationSettingsOut.model_validate(settings)


# ============ Analytics ============

@router.get("/systems/{system_id}/fraud/analytics")
def get_fraud_analytics(
    system_id: str,
    period: str = "week",  # today, week, month, custom
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get comprehensive fraud analytics"""
    verify_system_access(db, system_id, current_user)

    now = datetime.utcnow()
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)

    if period == "today":
        period_start = today_start
        period_end = now
    elif period == "week":
        period_start = today_start - timedelta(days=7)
        period_end = now
    elif period == "month":
        period_start = today_start - timedelta(days=30)
        period_end = now
    elif period == "custom":
        if not start_date or not end_date:
            raise HTTPException(status_code=400, detail="start_date and end_date required for custom period")
        period_start = datetime.fromisoformat(start_date)
        period_end = datetime.fromisoformat(end_date)
    else:
        period_start = today_start - timedelta(days=7)
        period_end = now

    fraud_service = FraudService(db)
    return fraud_service.get_analytics(system_id, period_start, period_end)


@router.get("/systems/{system_id}/fraud/analytics/queue-depth")
def get_queue_depth(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get current queue depth by risk level"""
    verify_system_access(db, system_id, current_user)

    queue_depth = {}
    for level in ["critical", "high", "medium", "low"]:
        queue_depth[level] = (
            db.query(FraudCase)
            .filter(
                FraudCase.decision_system_id == system_id,
                FraudCase.queue_level == level,
                FraudCase.status.in_(["pending", "in_review", "verification_pending"])
            )
            .count()
        )

    return queue_depth


@router.get("/systems/{system_id}/fraud/analytics/trend")
def get_fraud_trend(
    system_id: str,
    days: int = 7,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get daily fraud case trend"""
    verify_system_access(db, system_id, current_user)

    today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
    daily_trend = []

    for i in range(days):
        day_start = (today_start - timedelta(days=days-1-i))
        day_end = day_start + timedelta(days=1)

        day_cases = (
            db.query(FraudCase)
            .filter(
                FraudCase.decision_system_id == system_id,
                FraudCase.created_at >= day_start,
                FraudCase.created_at < day_end
            )
            .all()
        )

        daily_trend.append({
            "date": day_start.strftime("%Y-%m-%d"),
            "total": len(day_cases),
            "approved": len([c for c in day_cases if c.decision == "approved"]),
            "declined": len([c for c in day_cases if c.decision == "declined"]),
            "escalated": len([c for c in day_cases if c.decision == "escalated"])
        })

    return daily_trend


@router.get("/systems/{system_id}/fraud/analytics/signals")
def get_top_signals(
    system_id: str,
    limit: int = 10,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get top triggered signals"""
    verify_system_access(db, system_id, current_user)

    signals = (
        db.query(
            FraudSignal.signal_name,
            func.count(FraudSignal.id).label("trigger_count"),
            func.avg(FraudSignal.risk_contribution).label("avg_contribution")
        )
        .join(FraudCase)
        .filter(FraudCase.decision_system_id == system_id)
        .group_by(FraudSignal.signal_name)
        .order_by(func.count(FraudSignal.id).desc())
        .limit(limit)
        .all()
    )

    return [
        {
            "signal_name": s[0],
            "trigger_count": s[1],
            "avg_risk_contribution": round(float(s[2]), 1) if s[2] else 0
        }
        for s in signals
    ]


@router.get("/systems/{system_id}/fraud/analytics/analysts")
def get_analyst_performance(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get analyst performance metrics"""
    verify_system_access(db, system_id, current_user)

    # Get analysts with cases in this system
    analysts_with_cases = (
        db.query(FraudCase.decided_by)
        .filter(
            FraudCase.decision_system_id == system_id,
            FraudCase.decided_by.isnot(None)
        )
        .distinct()
        .all()
    )

    performance = []
    for (analyst_id,) in analysts_with_cases:
        analyst = db.query(User).filter(User.id == analyst_id).first()
        if not analyst:
            continue

        cases = (
            db.query(FraudCase)
            .filter(
                FraudCase.decision_system_id == system_id,
                FraudCase.decided_by == analyst_id
            )
            .all()
        )

        total_cases = len(cases)
        approved = len([c for c in cases if c.decision == "approved"])
        approval_rate = (approved / total_cases * 100) if total_cases > 0 else 0

        # Calculate SLA compliance
        now = datetime.utcnow()
        sla_met = len([c for c in cases if c.decided_at and c.decided_at <= c.sla_deadline])
        sla_compliance = (sla_met / total_cases * 100) if total_cases > 0 else 100

        performance.append({
            "analyst_id": analyst_id,
            "analyst_name": analyst.email,
            "cases_reviewed": total_cases,
            "avg_review_time_minutes": 0,  # TODO: Calculate
            "approval_rate": round(approval_rate, 1),
            "sla_compliance": round(sla_compliance, 1)
        })

    return performance


# ============ Rule Fields Reference ============

@router.get("/systems/{system_id}/fraud/rules/fields")
def get_rule_fields(
    system_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get available fields for fraud rule conditions"""
    verify_system_access(db, system_id, current_user)

    return RULE_FIELDS


# ============ Fraud Tier Configuration ============

class FraudTierConfigUpdate(BaseModel):
    low_max: Optional[float] = Field(None, ge=0.0, le=1.0)
    medium_max: Optional[float] = Field(None, ge=0.0, le=1.0)
    high_max: Optional[float] = Field(None, ge=0.0, le=1.0)
    auto_approve_low: Optional[bool] = None
    auto_block_critical: Optional[bool] = None
    dispositions: Optional[dict] = None


class FraudTierConfigOut(BaseModel):
    decision_system_id: str
    low_max: float
    medium_max: float
    high_max: float
    auto_approve_low: bool
    auto_block_critical: bool
    dispositions: Optional[dict] = None
    created_at: datetime
    updated_at: datetime

    class Config:
        from_attributes = True


@router.get("/fraud/tiers", response_model=FraudTierConfigOut)
def get_fraud_tier_config(
    system_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Get fraud tier configuration for a system"""
    verify_system_access(db, system_id, current_user)

    config = db.query(FraudTierConfig).filter(
        FraudTierConfig.decision_system_id == system_id
    ).first()

    if not config:
        # Create default configuration
        config = FraudTierConfig(
            decision_system_id=system_id,
            low_max=0.3,
            medium_max=0.6,
            high_max=0.8,
            auto_approve_low=True,
            auto_block_critical=True
        )
        db.add(config)
        db.commit()
        db.refresh(config)

    return FraudTierConfigOut.model_validate(config)


@router.post("/fraud/tiers", response_model=FraudTierConfigOut)
def create_fraud_tier_config(
    config_in: FraudTierConfigUpdate,
    system_id: str = Query(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create fraud tier configuration"""
    verify_system_access(db, system_id, current_user)

    # Check if config already exists
    existing = db.query(FraudTierConfig).filter(
        FraudTierConfig.decision_system_id == system_id
    ).first()

    if existing:
        raise HTTPException(status_code=400, detail="Tier configuration already exists. Use PUT to update.")

    # Validate thresholds
    low_max = config_in.low_max if config_in.low_max is not None else 0.3
    medium_max = config_in.medium_max if config_in.medium_max is not None else 0.6
    high_max = config_in.high_max if config_in.high_max is not None else 0.8

    if not (low_max < medium_max < high_max < 1.0):
        raise HTTPException(
            status_code=400,
            detail="Invalid thresholds: must satisfy low_max < medium_max < high_max < 1.0"
        )

    config = FraudTierConfig(
        decision_system_id=system_id,
        low_max=low_max,
        medium_max=medium_max,
        high_max=high_max,
        auto_approve_low=config_in.auto_approve_low if config_in.auto_approve_low is not None else True,
        auto_block_critical=config_in.auto_block_critical if config_in.auto_block_critical is not None else True
    )

    db.add(config)
    db.commit()
    db.refresh(config)

    return FraudTierConfigOut.model_validate(config)


@router.put("/fraud/tiers/{config_id}", response_model=FraudTierConfigOut)
def update_fraud_tier_config(
    config_id: str,
    config_in: FraudTierConfigUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update fraud tier configuration"""
    config = db.query(FraudTierConfig).filter(
        FraudTierConfig.decision_system_id == config_id
    ).first()

    if not config:
        raise HTTPException(status_code=404, detail="Tier configuration not found")

    verify_system_access(db, config.decision_system_id, current_user)

    # Update fields
    if config_in.low_max is not None:
        config.low_max = config_in.low_max
    if config_in.medium_max is not None:
        config.medium_max = config_in.medium_max
    if config_in.high_max is not None:
        config.high_max = config_in.high_max
    if config_in.auto_approve_low is not None:
        config.auto_approve_low = config_in.auto_approve_low
    if config_in.auto_block_critical is not None:
        config.auto_block_critical = config_in.auto_block_critical
    if config_in.dispositions is not None:
        config.dispositions = config_in.dispositions
        from sqlalchemy.orm.attributes import flag_modified
        flag_modified(config, "dispositions")

    # Validate thresholds
    if not (config.low_max < config.medium_max < config.high_max < 1.0):
        raise HTTPException(
            status_code=400,
            detail="Invalid thresholds: must satisfy low_max < medium_max < high_max < 1.0"
        )

    db.commit()
    db.refresh(config)

    return FraudTierConfigOut.model_validate(config)
