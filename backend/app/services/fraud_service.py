"""
Fraud Management Service - Business Logic Layer

Implements:
- Score calculation
- SLA management
- Auto-assignment
- Auto-decisioning
- Rule evaluation
- Escalation logic
"""
from datetime import datetime, timedelta
from typing import Optional, List, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_

from app.models.fraud import (
    FraudCase, FraudSignal, VerificationRequest, FraudRule, FraudRuleCondition,
    FraudModel, SignalProvider, FraudAutomationSettings,
    SLA_TARGETS, calculate_sla_deadline, score_to_risk_level
)
from app.models.user import User


# ============ Rule Fields (Available for rule conditions) ============

RULE_FIELDS = [
    # Score fields
    {"id": "fraud_score", "label": "Fraud Score", "type": "number", "category": "Score"},
    {"id": "identity_score", "label": "Identity Score", "type": "number", "category": "Score"},
    {"id": "device_score", "label": "Device Score", "type": "number", "category": "Score"},
    {"id": "velocity_score", "label": "Velocity Score", "type": "number", "category": "Score"},
    {"id": "behavioral_score", "label": "Behavioral Score", "type": "number", "category": "Score"},

    # Device signals
    {"id": "is_emulator", "label": "Is Emulator", "type": "boolean", "category": "Device"},
    {"id": "is_vpn", "label": "Using VPN/Proxy", "type": "boolean", "category": "Device"},
    {"id": "device_age_days", "label": "Device Age (Days)", "type": "number", "category": "Device"},
    {"id": "geolocation_mismatch", "label": "Geolocation Mismatch", "type": "boolean", "category": "Device"},

    # Velocity signals
    {"id": "apps_same_device_24h", "label": "Apps Same Device (24h)", "type": "number", "category": "Velocity"},
    {"id": "apps_same_ssn_7d", "label": "Apps Same SSN (7d)", "type": "number", "category": "Velocity"},
    {"id": "apps_same_email_7d", "label": "Apps Same Email (7d)", "type": "number", "category": "Velocity"},
    {"id": "apps_same_ip_24h", "label": "Apps Same IP (24h)", "type": "number", "category": "Velocity"},

    # Identity signals
    {"id": "ssn_mismatch", "label": "SSN Mismatch", "type": "boolean", "category": "Identity"},
    {"id": "synthetic_id_score", "label": "Synthetic ID Score", "type": "number", "category": "Identity"},
    {"id": "watchlist_hit", "label": "Watchlist Hit", "type": "boolean", "category": "Identity"},
    {"id": "deceased_ssn", "label": "Deceased SSN", "type": "boolean", "category": "Identity"},

    # Application data
    {"id": "requested_amount", "label": "Requested Amount", "type": "number", "category": "Application"},
    {"id": "applicant_state", "label": "Applicant State", "type": "string", "category": "Application"},
    {"id": "product_type", "label": "Product Type", "type": "string", "category": "Application"},
]


# ============ Model Features (Available for ML training) ============

FRAUD_MODEL_FEATURES = [
    # Scoring features
    {"id": "fraud_score", "name": "Current Fraud Score", "category": "Scoring"},
    {"id": "identity_subscore", "name": "Identity Subscore", "category": "Scoring"},
    {"id": "device_subscore", "name": "Device Subscore", "category": "Scoring"},
    {"id": "velocity_subscore", "name": "Velocity Subscore", "category": "Scoring"},

    # Device features
    {"id": "device_fingerprint_age", "name": "Device Fingerprint Age", "category": "Device"},
    {"id": "is_known_fraudster_device", "name": "Known Fraudster Device", "category": "Device"},
    {"id": "device_reputation_score", "name": "Device Reputation Score", "category": "Device"},
    {"id": "ip_risk_score", "name": "IP Risk Score", "category": "Device"},

    # Velocity features
    {"id": "ssn_velocity", "name": "SSN Velocity (7d)", "category": "Velocity"},
    {"id": "email_velocity", "name": "Email Velocity (7d)", "category": "Velocity"},
    {"id": "phone_velocity", "name": "Phone Velocity (7d)", "category": "Velocity"},
    {"id": "address_velocity", "name": "Address Velocity (30d)", "category": "Velocity"},

    # Identity features
    {"id": "name_ssn_match_score", "name": "Name-SSN Match Score", "category": "Identity"},
    {"id": "address_stability_score", "name": "Address Stability Score", "category": "Identity"},
    {"id": "identity_age", "name": "Identity Age (months)", "category": "Identity"},
    {"id": "credit_file_depth", "name": "Credit File Depth", "category": "Identity"},

    # Behavioral features
    {"id": "session_duration", "name": "Session Duration", "category": "Behavioral"},
    {"id": "form_completion_time", "name": "Form Completion Time", "category": "Behavioral"},
    {"id": "mouse_movement_entropy", "name": "Mouse Movement Entropy", "category": "Behavioral"},
    {"id": "typing_cadence_score", "name": "Typing Cadence Score", "category": "Behavioral"},

    # Application features
    {"id": "requested_amount", "name": "Requested Amount", "category": "Application"},
    {"id": "time_of_day", "name": "Time of Day", "category": "Application"},
    {"id": "day_of_week", "name": "Day of Week", "category": "Application"},
]


class FraudService:
    """Service class for fraud management business logic"""

    def __init__(self, db: Session):
        self.db = db

    # ============ Score Calculation ============

    def calculate_fraud_score(self, signals: List[FraudSignal]) -> Dict[str, Any]:
        """
        Calculate composite fraud score from signals.
        Returns score object with total_score, risk_level, and component_scores.
        """
        # Component weights
        weights = {
            "identity": 0.30,
            "device": 0.25,
            "velocity": 0.25,
            "behavioral": 0.20
        }

        component_scores = {"identity": 0, "device": 0, "velocity": 0, "behavioral": 0}

        for signal in signals:
            signal_type = signal.signal_type
            if signal_type in component_scores:
                component_scores[signal_type] += signal.risk_contribution

        # Cap each component at 100
        for key in component_scores:
            component_scores[key] = min(component_scores[key], 100)

        # Calculate weighted total (scale to 0-1000)
        total = sum(
            component_scores.get(t, 0) * w * 10
            for t, w in weights.items()
        )
        total_score = min(int(total), 1000)

        return {
            "total_score": total_score,
            "risk_level": score_to_risk_level(total_score),
            "component_scores": {
                "identity_score": component_scores["identity"],
                "device_score": component_scores["device"],
                "velocity_score": component_scores["velocity"],
                "behavioral_score": component_scores["behavioral"]
            }
        }

    # ============ Auto-Assignment Logic ============

    def auto_assign_case(
        self,
        case: FraudCase,
        settings: FraudAutomationSettings
    ) -> Optional[str]:
        """
        Auto-assign a case to an analyst based on settings.
        Returns analyst_id if assigned, None otherwise.
        """
        if not settings or not settings.auto_assign_enabled:
            return None

        available_analysts = self._get_analysts_with_capacity(
            case.decision_system_id,
            settings.max_cases_per_analyst
        )

        if not available_analysts:
            return None

        if settings.assignment_strategy == "round_robin":
            return self._get_next_analyst_round_robin(available_analysts)
        elif settings.assignment_strategy == "load_balanced":
            return self._get_analyst_with_lowest_load(available_analysts)
        elif settings.assignment_strategy == "skill_based":
            return self._get_best_skilled_analyst(available_analysts, case.queue_level)

        return None

    def _get_analysts_with_capacity(
        self,
        decision_system_id: str,
        max_cases: int
    ) -> List[User]:
        """Get analysts who have capacity for more cases"""
        # Get analysts and their current case counts
        from sqlalchemy import func

        subquery = (
            self.db.query(
                FraudCase.assigned_analyst_id,
                func.count(FraudCase.id).label("case_count")
            )
            .filter(
                FraudCase.decision_system_id == decision_system_id,
                FraudCase.status.in_(["pending", "in_review", "verification_pending"]),
                FraudCase.assigned_analyst_id.isnot(None)
            )
            .group_by(FraudCase.assigned_analyst_id)
            .subquery()
        )

        # Get all analysts (simplified - in production would filter by role/permissions)
        analysts = self.db.query(User).all()

        available = []
        for analyst in analysts:
            # Count cases for this analyst
            case_count = (
                self.db.query(func.count(FraudCase.id))
                .filter(
                    FraudCase.assigned_analyst_id == analyst.id,
                    FraudCase.status.in_(["pending", "in_review", "verification_pending"])
                )
                .scalar()
            ) or 0

            if case_count < max_cases:
                available.append((analyst, case_count))

        return available

    def _get_next_analyst_round_robin(self, available: List[Tuple[User, int]]) -> Optional[str]:
        """Round-robin assignment - pick analyst with oldest last assignment"""
        if not available:
            return None
        # Simple: just pick the first available
        return available[0][0].id

    def _get_analyst_with_lowest_load(self, available: List[Tuple[User, int]]) -> Optional[str]:
        """Load-balanced assignment - pick analyst with fewest cases"""
        if not available:
            return None
        sorted_analysts = sorted(available, key=lambda x: x[1])
        return sorted_analysts[0][0].id

    def _get_best_skilled_analyst(
        self,
        available: List[Tuple[User, int]],
        queue_level: str
    ) -> Optional[str]:
        """Skill-based assignment - for critical/high cases, prefer experienced analysts"""
        if not available:
            return None
        # Simplified: for critical/high, use load-balanced among available
        return self._get_analyst_with_lowest_load(available)

    # ============ Auto-Decisioning Logic ============

    def check_auto_decision(
        self,
        case: FraudCase,
        settings: FraudAutomationSettings
    ) -> Optional[str]:
        """
        Check if case qualifies for auto-decisioning.
        Returns "approved", "declined", or None (requires manual review).
        """
        if not settings or not settings.auto_decision_enabled:
            return None

        score = case.total_score

        if score < settings.auto_approve_below_score:
            return "approved"
        elif score > settings.auto_decline_above_score:
            return "declined"

        return None

    # ============ Rule Evaluation ============

    def evaluate_rules(
        self,
        case: FraudCase,
        case_data: Dict[str, Any]
    ) -> List[Dict[str, Any]]:
        """
        Evaluate fraud rules against a case.
        Returns list of triggered rule actions.
        """
        rules = (
            self.db.query(FraudRule)
            .filter(
                FraudRule.decision_system_id == case.decision_system_id,
                FraudRule.is_active == True
            )
            .order_by(FraudRule.priority)
            .all()
        )

        triggered_actions = []

        for rule in rules:
            if self._evaluate_rule_conditions(rule, case, case_data):
                # Update trigger stats
                rule.trigger_count += 1
                rule.last_triggered_at = datetime.utcnow()

                triggered_actions.append({
                    "rule_id": rule.id,
                    "rule_name": rule.name,
                    "action": rule.action,
                    "action_config": rule.action_config
                })

        self.db.commit()
        return triggered_actions

    def _evaluate_rule_conditions(
        self,
        rule: FraudRule,
        case: FraudCase,
        case_data: Dict[str, Any]
    ) -> bool:
        """Evaluate all conditions for a rule"""
        conditions = rule.conditions
        if not conditions:
            return False

        results = []
        for condition in conditions:
            result = self._evaluate_condition(condition, case, case_data)
            results.append(result)

        if rule.condition_logic == "AND":
            return all(results)
        else:  # OR
            return any(results)

    def _evaluate_condition(
        self,
        condition: FraudRuleCondition,
        case: FraudCase,
        case_data: Dict[str, Any]
    ) -> bool:
        """Evaluate a single condition"""
        field = condition.field
        operator = condition.operator
        expected_value = condition.value

        # Get actual value from case or case_data
        actual_value = self._get_field_value(field, case, case_data)

        if actual_value is None:
            return False

        return self._compare_values(actual_value, operator, expected_value)

    def _get_field_value(
        self,
        field: str,
        case: FraudCase,
        case_data: Dict[str, Any]
    ) -> Any:
        """Get field value from case or case_data"""
        # Score fields from case
        score_fields = {
            "fraud_score": case.total_score,
            "identity_score": case.identity_score,
            "device_score": case.device_score,
            "velocity_score": case.velocity_score,
            "behavioral_score": case.behavioral_score,
        }

        if field in score_fields:
            return score_fields[field]

        # Other fields from case_data
        return case_data.get(field)

    def _compare_values(self, actual: Any, operator: str, expected: Any) -> bool:
        """Compare values based on operator"""
        try:
            if operator == "equals":
                return actual == expected
            elif operator == "not_equals":
                return actual != expected
            elif operator == "greater_than":
                return float(actual) > float(expected)
            elif operator == "less_than":
                return float(actual) < float(expected)
            elif operator == "contains":
                return str(expected).lower() in str(actual).lower()
            elif operator == "not_contains":
                return str(expected).lower() not in str(actual).lower()
            elif operator == "in":
                return actual in expected
            elif operator == "not_in":
                return actual not in expected
            elif operator == "is_true":
                return bool(actual) is True
            elif operator == "is_false":
                return bool(actual) is False
        except (ValueError, TypeError):
            return False

        return False

    def simulate_rule(
        self,
        decision_system_id: str,
        conditions: List[Dict],
        condition_logic: str,
        sample_size: int = 1000
    ) -> Dict[str, Any]:
        """
        Simulate a rule against historical cases.
        Returns trigger rate and sample of triggered cases.
        """
        # Get recent cases for simulation
        cases = (
            self.db.query(FraudCase)
            .filter(FraudCase.decision_system_id == decision_system_id)
            .order_by(FraudCase.created_at.desc())
            .limit(sample_size)
            .all()
        )

        triggered_cases = []
        for case in cases:
            # Evaluate conditions
            results = []
            triggered_conditions = []

            for i, cond in enumerate(conditions):
                field = cond.get("field")
                operator = cond.get("operator")
                value = cond.get("value")

                actual = self._get_field_value(field, case, {})
                if actual is not None and self._compare_values(actual, operator, value):
                    results.append(True)
                    triggered_conditions.append(cond.get("id", f"condition_{i}"))
                else:
                    results.append(False)

            # Check if rule would trigger
            triggered = all(results) if condition_logic == "AND" else any(results)

            if triggered:
                triggered_cases.append({
                    "case_id": case.id,
                    "applicant_name": case.applicant_name,
                    "score": case.total_score,
                    "triggered_conditions": triggered_conditions
                })

        total_evaluated = len(cases)
        total_triggered = len(triggered_cases)
        trigger_rate = (total_triggered / total_evaluated * 100) if total_evaluated > 0 else 0

        return {
            "total_evaluated": total_evaluated,
            "total_triggered": total_triggered,
            "trigger_rate": round(trigger_rate, 2),
            "sample_cases": triggered_cases[:10]  # Return first 10 samples
        }

    # ============ Escalation Logic ============

    def check_escalation(
        self,
        case: FraudCase,
        settings: FraudAutomationSettings
    ) -> bool:
        """
        Check if a case should be escalated.
        Returns True if escalation is needed.
        """
        if case.status == "escalated":
            return False

        if not settings or not settings.auto_escalate_on_timeout:
            return False

        time_in_queue = datetime.utcnow() - case.created_at
        timeout = timedelta(minutes=settings.escalation_timeout_minutes)

        if time_in_queue > timeout and case.status in ["pending", "in_review"]:
            return True

        return False

    def get_cases_breaching_sla(self, decision_system_id: str) -> List[FraudCase]:
        """Get cases that are breaching their SLA"""
        now = datetime.utcnow()
        return (
            self.db.query(FraudCase)
            .filter(
                FraudCase.decision_system_id == decision_system_id,
                FraudCase.status.in_(["pending", "in_review", "verification_pending"]),
                FraudCase.sla_deadline < now
            )
            .all()
        )

    # ============ Analytics ============

    def get_analytics(
        self,
        decision_system_id: str,
        period_start: datetime,
        period_end: datetime
    ) -> Dict[str, Any]:
        """Get comprehensive fraud analytics for a decision system"""

        # Base query for the period
        base_query = self.db.query(FraudCase).filter(
            FraudCase.decision_system_id == decision_system_id,
            FraudCase.created_at >= period_start,
            FraudCase.created_at <= period_end
        )

        # Summary metrics
        total_cases = base_query.count()

        today_start = datetime.utcnow().replace(hour=0, minute=0, second=0, microsecond=0)
        cases_today = base_query.filter(FraudCase.created_at >= today_start).count()

        pending_cases = base_query.filter(
            FraudCase.status.in_(["pending", "in_review", "verification_pending"])
        ).count()

        decided_cases = base_query.filter(FraudCase.status == "decided").all()
        approved_count = len([c for c in decided_cases if c.decision == "approved"])
        approval_rate = (approved_count / len(decided_cases) * 100) if decided_cases else 0

        # SLA compliance
        now = datetime.utcnow()
        sla_breached = base_query.filter(
            FraudCase.sla_deadline < now,
            FraudCase.status.in_(["pending", "in_review", "verification_pending"])
        ).count()
        sla_compliance = ((total_cases - sla_breached) / total_cases * 100) if total_cases > 0 else 100

        # Queue depth
        queue_depth = {}
        for level in ["critical", "high", "medium", "low"]:
            queue_depth[level] = (
                self.db.query(FraudCase)
                .filter(
                    FraudCase.decision_system_id == decision_system_id,
                    FraudCase.queue_level == level,
                    FraudCase.status.in_(["pending", "in_review", "verification_pending"])
                )
                .count()
            )

        # Score distribution
        score_ranges = [
            ("0-100", 0, 100), ("100-200", 100, 200), ("200-300", 200, 300),
            ("300-400", 300, 400), ("400-500", 400, 500), ("500-600", 500, 600),
            ("600-700", 600, 700), ("700-800", 700, 800), ("800-900", 800, 900),
            ("900-1000", 900, 1001)
        ]
        score_distribution = []
        for label, min_score, max_score in score_ranges:
            count = base_query.filter(
                FraudCase.total_score >= min_score,
                FraudCase.total_score < max_score
            ).count()
            score_distribution.append({"range": label, "count": count})

        # Daily trend (last 7 days)
        daily_trend = []
        for i in range(7):
            day_start = (today_start - timedelta(days=6-i))
            day_end = day_start + timedelta(days=1)

            day_cases = (
                self.db.query(FraudCase)
                .filter(
                    FraudCase.decision_system_id == decision_system_id,
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

        # Top triggered signals
        signals = (
            self.db.query(
                FraudSignal.signal_name,
                func.count(FraudSignal.id).label("trigger_count"),
                func.avg(FraudSignal.risk_contribution).label("avg_contribution")
            )
            .join(FraudCase)
            .filter(
                FraudCase.decision_system_id == decision_system_id,
                FraudCase.created_at >= period_start,
                FraudCase.created_at <= period_end
            )
            .group_by(FraudSignal.signal_name)
            .order_by(func.count(FraudSignal.id).desc())
            .limit(10)
            .all()
        )

        top_signals = [
            {
                "signal_name": s[0],
                "trigger_count": s[1],
                "avg_risk_contribution": round(float(s[2]), 1) if s[2] else 0
            }
            for s in signals
        ]

        return {
            "decision_system_id": decision_system_id,
            "period_start": period_start.isoformat(),
            "period_end": period_end.isoformat(),
            "cases_today": cases_today,
            "cases_pending": pending_cases,
            "sla_compliance": round(sla_compliance, 1),
            "approval_rate": round(approval_rate, 1),
            "avg_review_time_minutes": 0,  # TODO: Calculate from decided_at - created_at
            "queue_depth": queue_depth,
            "score_distribution": score_distribution,
            "daily_trend": daily_trend,
            "top_signals": top_signals,
            "analyst_performance": []  # TODO: Implement
        }
