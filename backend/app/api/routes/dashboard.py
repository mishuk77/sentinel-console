from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import Optional
from app.db.session import SessionLocal
from app.models.decision import Decision
from app.models.policy import Policy
from app.models.ml_model import MLModel

router = APIRouter()

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.get("/stats")
def get_dashboard_stats(system_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Decision)
    if system_id:
        q = q.filter(Decision.decision_system_id == system_id)
    total_decisions = q.count()
    approvals = q.filter(Decision.decision == "APPROVE").count()
    approval_rate = (approvals / total_decisions) if total_decisions > 0 else 0.0

    return {
        "volume": total_decisions,
        "approvals": approvals,
        "approval_rate": approval_rate,
        # Legacy keys
        "volume_24h": total_decisions,
        "approval_rate_24h": approval_rate,
    }

@router.get("/deployment-status")
def get_deployment_status(system_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Policy).filter(Policy.is_active == True)
    if system_id:
        q = q.filter(Policy.decision_system_id == system_id)
    active_policy = q.order_by(Policy.created_at.desc()).first()

    if not active_policy:
        return {"status": "No Active Policy"}

    model = db.query(MLModel).filter(MLModel.id == active_policy.model_id).first()

    return {
        "status": "Active",
        "model": {
            "name": model.name if model else "Unknown",
            "version": model.id[:8] if model else "N/A",
            "algorithm": model.algorithm if model else "N/A"
        },
        "policy": {
            "name": "Active Policy",
            "target_decile": active_policy.target_decile,
            "projected_approval": active_policy.projected_approval_rate,
            "projected_loss": active_policy.projected_loss_rate,
            "last_updated": active_policy.created_at
        }
    }

@router.get("/volume")
def get_volume_stats(system_id: Optional[str] = None, db: Session = Depends(get_db)):
    q = db.query(Decision.timestamp, Decision.decision)
    if system_id:
        q = q.filter(Decision.decision_system_id == system_id)
    records = q.order_by(Decision.timestamp.asc()).all()

    data = {}
    for r in records:
        day = r.timestamp.strftime("%Y-%m-%d")
        if day not in data:
            data[day] = {"date": day, "total": 0, "approved": 0}
        data[day]["total"] += 1
        if r.decision == "APPROVE":
            data[day]["approved"] += 1

    return list(data.values())

@router.get("/daily-breakdown")
def get_daily_breakdown(system_id: Optional[str] = None, db: Session = Depends(get_db)):
    """
    Daily breakdown with credit score, fraud score, amounts, and fraud tier distribution.
    Python-side aggregation for SQL dialect neutrality.
    """
    q = db.query(
        Decision.timestamp,
        Decision.decision,
        Decision.score,
        Decision.fraud_score,
        Decision.fraud_tier,
        Decision.approved_amount,
    )
    if system_id:
        q = q.filter(Decision.decision_system_id == system_id)

    records = q.order_by(Decision.timestamp.asc()).all()

    data = {}
    for r in records:
        if not r.timestamp:
            continue
        day = r.timestamp.strftime("%Y-%m-%d")
        if day not in data:
            data[day] = {
                "date": day,
                "applications": 0,
                "approvals": 0,
                "credit_scores": [],
                "fraud_scores": [],
                "approved_amounts": [],
                "fraud_low": 0,
                "fraud_medium": 0,
                "fraud_high": 0,
                "fraud_critical": 0,
            }

        d = data[day]
        d["applications"] += 1
        if r.decision == "APPROVE":
            d["approvals"] += 1
        if r.score is not None:
            d["credit_scores"].append(r.score)
        if r.fraud_score is not None:
            d["fraud_scores"].append(r.fraud_score)
        if r.approved_amount is not None:
            d["approved_amounts"].append(r.approved_amount)

        tier = (r.fraud_tier or "").upper()
        if tier == "LOW":
            d["fraud_low"] += 1
        elif tier == "MEDIUM":
            d["fraud_medium"] += 1
        elif tier == "HIGH":
            d["fraud_high"] += 1
        elif tier == "CRITICAL":
            d["fraud_critical"] += 1

    # Compute averages and percentages
    result = []
    for day_data in data.values():
        n = day_data["applications"]
        approvals = day_data["approvals"]
        cs = day_data["credit_scores"]
        fs = day_data["fraud_scores"]
        amts = day_data["approved_amounts"]
        fraud_total = day_data["fraud_low"] + day_data["fraud_medium"] + day_data["fraud_high"] + day_data["fraud_critical"]

        result.append({
            "date": day_data["date"],
            "applications": n,
            "avg_credit_score": round(sum(cs) / len(cs), 6) if cs else None,
            "avg_fraud_score": round(sum(fs) / len(fs), 6) if fs else None,
            "approvals": approvals,
            "approval_rate": round(approvals / n, 4) if n > 0 else 0,
            "avg_approved_amount": round(sum(amts) / len(amts), 2) if amts else None,
            "fraud_low_pct": round(day_data["fraud_low"] / fraud_total * 100, 1) if fraud_total > 0 else None,
            "fraud_medium_pct": round(day_data["fraud_medium"] / fraud_total * 100, 1) if fraud_total > 0 else None,
            "fraud_high_pct": round(day_data["fraud_high"] / fraud_total * 100, 1) if fraud_total > 0 else None,
            "fraud_critical_pct": round(day_data["fraud_critical"] / fraud_total * 100, 1) if fraud_total > 0 else None,
        })

    return result
