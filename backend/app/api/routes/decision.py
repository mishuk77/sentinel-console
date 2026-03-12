from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.db.session import SessionLocal
from app.models.decision import Decision
from app.services.decision_service import decision_service
from pydantic import BaseModel
from typing import Dict, Any, Optional

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

class DecisionRequest(BaseModel):
    applicant_name: Optional[str] = None
    applicant_ssn: Optional[str] = None
    inputs: Dict[str, Any]

class PredictRequest(BaseModel):
    model_id: str
    inputs: Dict[str, Any]

    model_config = {
        "protected_namespaces": ()
    }

# ── Static routes MUST come before /{system_id} ─────────────

@router.get("/")
def list_decisions(
    system_id: str = None,
    skip: int = 0,
    limit: int = 50,
    applicant_name: Optional[str] = None,
    db: Session = Depends(get_db)
):
    query = db.query(Decision)
    if system_id:
        query = query.filter(Decision.decision_system_id == system_id)
    if applicant_name:
        query = query.filter(Decision.applicant_name.ilike(f"%{applicant_name}%"))
    return query.order_by(Decision.timestamp.desc()).offset(skip).limit(limit).all()

@router.post("/predict")
def predict_raw(req: PredictRequest, db: Session = Depends(get_db)):
    """
    Get raw score from a specific model without generating a decision record.
    """
    try:
        return decision_service.predict_raw(db, req.model_id, req.inputs)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        print(f"Prediction Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Prediction Error")

@router.get("/stats/overview")
def get_decision_stats(system_id: str, days: int = 7, db: Session = Depends(get_db)):
    """
    Get aggregated statistics for the decision system over the specified time range.
    """
    from sqlalchemy import func, case, text
    from datetime import datetime, timedelta

    # 1. Calculate Date Range
    end_date = datetime.utcnow()
    start_date = end_date - timedelta(days=days)

    daily_stats_query = db.query(
        func.date(Decision.timestamp).label('date'),
        func.count(Decision.id).label('count'),
        func.sum(case((Decision.decision == 'APPROVE', 1), else_=0)).label('approved')
    ).filter(
        Decision.decision_system_id == system_id,
        Decision.timestamp >= start_date
    ).group_by(
        func.date(Decision.timestamp)
    ).order_by(
        func.date(Decision.timestamp)
    ).all()

    stats_history = []
    for row in daily_stats_query:
        date_str = row[0]
        total = row[1]
        approved = row[2] or 0
        approval_rate = (approved / total) if total > 0 else 0.0

        stats_history.append({
            "date": date_str,
            "volume": total,
            "approved": approved,
            "rejected": total - approved,
            "approval_rate": approval_rate
        })

    # 3. Aggregate 24h Stats
    start_24h = end_date - timedelta(hours=24)
    last_24h_query = db.query(
        func.count(Decision.id).label('count'),
        func.sum(case((Decision.decision == 'APPROVE', 1), else_=0)).label('approved')
    ).filter(
        Decision.decision_system_id == system_id,
        Decision.timestamp >= start_24h
    ).first()

    total_24h = last_24h_query[0] or 0
    approved_24h = last_24h_query[1] or 0
    rate_24h = (approved_24h / total_24h) if total_24h > 0 else 0.0

    return {
        "period": f"Last {days} Days",
        "total_volume_24h": total_24h,
        "approval_rate_24h": rate_24h,
        "history": stats_history
    }

# ── Dynamic routes ───────────────────────────────────────────

@router.get("/{decision_id}")
def get_decision(decision_id: str, db: Session = Depends(get_db)):
    record = db.query(Decision).filter(Decision.id == decision_id).first()
    if not record:
        raise HTTPException(status_code=404, detail="Decision not found")
    return record

@router.post("/{system_id}")
def make_decision(system_id: str, req: DecisionRequest, db: Session = Depends(get_db)):
    try:
        # Delegate to service
        result = decision_service.make_decision(db, req.inputs, system_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        print(f"Decision Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Decision Error")

    # Extract fraud fields from structured response
    fraud_assess = result.get('fraud_risk_assessment', {})
    adverse = result.get('adverse_action_notice', {})

    # Save Record
    decision_record = Decision(
        decision_system_id=result['decision_system_id'],
        input_payload=req.inputs,
        applicant_name=req.applicant_name,
        applicant_ssn=req.applicant_ssn,
        score=result['score'],
        decision=result['decision'],
        model_version_id=result['model_id'],
        policy_version_id=result['policy_id'],
        reason_codes=result['reason_codes'],
        metric_decile=result.get('metric_decile'),
        allowed_amount=result.get('allowed_amount'),
        approved_amount=result.get('approved_amount'),
        fraud_score=fraud_assess.get('fraud_probability'),
        fraud_tier=fraud_assess.get('risk_tier'),
        fraud_action=fraud_assess.get('recommended_action'),
        fraud_model_id=fraud_assess.get('model_id'),
        adverse_action_factors=adverse.get('factors'),
    )
    db.add(decision_record)
    db.commit()
    db.refresh(decision_record)

    # Return the full bureau-style response (not just the DB record)
    from datetime import datetime
    return {
        "inquiry_id": decision_record.id,
        "timestamp": decision_record.timestamp.isoformat() if decision_record.timestamp else datetime.utcnow().isoformat(),
        "system_id": result['decision_system_id'],
        "applicant": {
            "name": req.applicant_name,
            "reference_id": req.applicant_ssn,
        },
        "input_payload": req.inputs,
        "credit_risk_assessment": result['credit_risk_assessment'],
        "adverse_action_notice": result['adverse_action_notice'],
        "fraud_risk_assessment": result['fraud_risk_assessment'],
        "exposure_control": {
            "risk_decile": result.get('metric_decile'),
            "allowed_amount": result.get('allowed_amount'),
            "approved_amount": result.get('approved_amount'),
        },
        "pipeline_metadata": {
            "credit_model_version": result['model_id'],
            "fraud_model_version": fraud_assess.get('model_id'),
            "policy_version": result['policy_id'],
        }
    }
