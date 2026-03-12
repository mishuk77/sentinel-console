import pandas as pd
import joblib
import io
import os
from sqlalchemy.orm import Session
from app.models.ml_model import MLModel, ModelStatus
from app.models.policy import Policy
from app.services.storage import storage
from app.services.loan_amount import loan_amount_service

class DecisionService:
    def __init__(self):
        self._model_cache = {} # version_id -> model_obj

    def _load_model(self, model: MLModel):
        if model.id in self._model_cache:
            return self._model_cache[model.id]
        
        print(f"Loading model {model.id} from {model.artifact_path}...")
        # Download Pkl
        # We need a way to get bytes directly or download to temp
        # storage.download_file copies to a path.
        local_path = f"temp_model_{model.id}.pkl"
        storage.download_file(model.artifact_path, local_path)
        
        loaded_model = joblib.load(local_path)
        self._model_cache[model.id] = loaded_model
        
        # Cleanup
        if os.path.exists(local_path):
            os.remove(local_path)
            
        return loaded_model

    def _compute_shap(self, clf, df):
        """Compute SHAP values for a model. Returns list of (feature, value) sorted by abs contribution."""
        try:
            import shap
            model_type = type(clf).__name__.lower()
            explainer = None

            if "xgb" in model_type or "forest" in model_type:
                explainer = shap.TreeExplainer(clf)
                shap_values = explainer.shap_values(df)
            elif "logistic" in model_type and hasattr(clf, "coef_"):
                # Approximate SHAP for linear: coefficient * feature value
                coefs = clf.coef_[0]
                row = df.iloc[0].values
                contributions = dict(zip(df.columns, [float(c * v) for c, v in zip(coefs, row)]))
                return sorted(contributions.items(), key=lambda x: abs(x[1]), reverse=True)

            if explainer:
                vals = shap_values
                if isinstance(vals, list):
                    vals = vals[1]  # Class 1
                row_values = vals[0] if len(vals) > 0 else []
                contributions = dict(zip(df.columns, [float(v) for v in row_values]))
                return sorted(contributions.items(), key=lambda x: abs(x[1]), reverse=True)
        except Exception as e:
            print(f"SHAP Error: {e}")
        return []

    def _score_model(self, db, model, input_data):
        """Score a single model and return (score, prepared_df)."""
        clf = self._load_model(model)
        df = pd.DataFrame([input_data])
        if hasattr(clf, "feature_names_in_"):
            df = df.reindex(columns=clf.feature_names_in_, fill_value=0)
        score = clf.predict_proba(df)[0][1]
        return float(score), df, clf

    def _determine_fraud_tier(self, fraud_score, tier_config):
        """Determine fraud tier and disposition from score + config."""
        if not tier_config:
            return None, None, None

        if fraud_score <= tier_config.low_max:
            tier = "LOW"
            action = "PROCEED"
        elif fraud_score <= tier_config.medium_max:
            tier = "MEDIUM"
            action = "STEP_UP_VERIFICATION"
        elif fraud_score <= tier_config.high_max:
            tier = "HIGH"
            action = "MANUAL_REVIEW"
        else:
            tier = "CRITICAL"
            action = "MANUAL_REVIEW_CRITICAL_ALERT"

        # Get specific disposition from config
        dispositions = tier_config.dispositions or {}
        disposition_detail = None
        if tier == "LOW":
            disposition_detail = dispositions.get("low", "no_verification")
        elif tier == "MEDIUM":
            method = dispositions.get("medium_method", "otp")
            disposition_detail = f"step_up_{method}"
        elif tier == "HIGH":
            disposition_detail = dispositions.get("high", "manual_review")
        elif tier == "CRITICAL":
            disposition_detail = dispositions.get("critical", "manual_review_critical_alert")

        return tier, action, disposition_detail

    def make_decision(self, db: Session, input_data: dict, system_id: str):
        from app.models.fraud import FraudTierConfig
        from app.models.decision_system import DecisionSystem

        # Determine system type
        ds = db.query(DecisionSystem).filter(DecisionSystem.id == system_id).first()
        system_type = (ds.system_type if ds else None) or "full"

        # ── Credit pipeline (skip for fraud-only systems) ────────
        credit_score = None
        credit_df = None
        credit_clf = None
        credit_model = None
        active_policy = None
        result_str = None
        metric_decile = None
        allowed_amount = None
        approved_amount = None
        shap_contributions = []
        adverse_action_factors = []
        reason_codes = {}

        if system_type in ("credit", "full"):
            active_policy = db.query(Policy).filter(
                Policy.decision_system_id == system_id,
                Policy.is_active == True
            ).first()

            if not active_policy:
                raise ValueError("No active policy found for this decision system. Please configure and activate a policy.")

            credit_model = active_policy.model
            if not credit_model:
                 raise ValueError("Active policy has no associated model.")

            credit_score, credit_df, credit_clf = self._score_model(db, credit_model, input_data)

            # Credit Decision (Policy)
            result_str = "APPROVE" if credit_score < active_policy.threshold else "DECLINE"

            # Exposure Control (Loan Amount Ladder)
            if result_str == "APPROVE":
                requested_amount = input_data.get("requested_amount") or input_data.get("loan_amount") or input_data.get("amount")
                if requested_amount:
                    requested_amount = float(requested_amount)

                if active_policy.amount_ladder:
                    calibration = credit_model.metrics.get("calibration", []) if credit_model.metrics else []
                    ladder_res = loan_amount_service.apply_ladder(
                        active_policy.amount_ladder, credit_score, requested_amount, calibration
                    )
                    if ladder_res:
                        metric_decile = ladder_res["decile"]
                        allowed_amount = ladder_res["allowed_amount"]
                        approved_amount = ladder_res["approved_amount"]

            # Adverse Action Attributes (SHAP)
            shap_contributions = self._compute_shap(credit_clf, credit_df)
            for feat, val in shap_contributions[:4]:
                if val > 0:
                    adverse_action_factors.append({
                        "factor": feat,
                        "impact": round(val, 6),
                        "direction": "risk_increasing"
                    })
            if len(adverse_action_factors) < 4:
                for feat, val in shap_contributions[:4]:
                    already = {a["factor"] for a in adverse_action_factors}
                    if feat not in already:
                        adverse_action_factors.append({
                            "factor": feat,
                            "impact": round(abs(val), 6),
                            "direction": "risk_increasing" if val > 0 else "risk_decreasing"
                        })
                    if len(adverse_action_factors) >= 4:
                        break

            reason_codes = {
                "cutoff": float(active_policy.threshold),
                "score": float(credit_score),
            }
            for f, v in shap_contributions[:3]:
                reason_codes[f] = float(v)

        # ── Fraud pipeline (skip for credit-only systems) ────────
        fraud_score = None
        fraud_tier = None
        fraud_action = None
        fraud_disposition = None
        fraud_model_id = None
        fraud_model = None

        if system_type in ("fraud", "full"):
            # Find active fraud model in this system
            active_models = db.query(MLModel).filter(
                MLModel.decision_system_id == system_id,
                MLModel.status == ModelStatus.ACTIVE
            ).all()
            for m in active_models:
                m_context = (m.metrics or {}).get("model_context")
                if m_context == "fraud":
                    fraud_model = m
                    break

            if fraud_model:
                try:
                    fraud_score_val, _, _ = self._score_model(db, fraud_model, input_data)
                    fraud_score = fraud_score_val
                    fraud_model_id = fraud_model.id

                    tier_config = db.query(FraudTierConfig).filter(
                        FraudTierConfig.decision_system_id == system_id
                    ).first()

                    fraud_tier, fraud_action, fraud_disposition = self._determine_fraud_tier(fraud_score, tier_config)
                except Exception as e:
                    print(f"Fraud scoring error: {e}")

        # For fraud-only systems, decision is based on fraud tier
        if system_type == "fraud" and result_str is None:
            if fraud_tier in ("HIGH", "CRITICAL"):
                result_str = "DECLINE"
            elif fraud_tier == "MEDIUM":
                result_str = "REVIEW"
            else:
                result_str = "APPROVE"

        # ── Build Bureau-Style Response ───────────────────────────
        return {
            "decision_system_id": system_id,
            "system_type": system_type,
            "score": float(credit_score) if credit_score is not None else None,
            "decision": result_str or "APPROVE",
            "model_id": credit_model.id if credit_model else None,
            "policy_id": active_policy.id if active_policy else None,
            "threshold": active_policy.threshold if active_policy else None,
            "reason_codes": reason_codes,
            "metric_decile": metric_decile,
            "allowed_amount": allowed_amount,
            "approved_amount": approved_amount,
            "credit_risk_assessment": {
                "model_id": credit_model.id if credit_model else None,
                "model_name": credit_model.name if credit_model else None,
                "algorithm": credit_model.algorithm if credit_model else None,
                "probability_of_default": round(float(credit_score), 6) if credit_score is not None else None,
                "risk_decile": metric_decile,
                "policy_threshold": round(float(active_policy.threshold), 6) if active_policy else None,
                "decision": result_str,
                "approved_amount": approved_amount,
                "allowed_amount": allowed_amount,
            } if system_type in ("credit", "full") else None,
            "adverse_action_notice": {
                "required": result_str == "DECLINE",
                "factors": adverse_action_factors,
                "methodology": "SHAP (SHapley Additive exPlanations)",
                "regulatory_basis": "ECOA / FCRA Reg B"
            } if system_type in ("credit", "full") else None,
            "fraud_risk_assessment": {
                "model_id": fraud_model_id,
                "fraud_probability": round(fraud_score, 6) if fraud_score is not None else None,
                "risk_tier": fraud_tier,
                "recommended_action": fraud_action,
                "disposition": fraud_disposition,
                "tier_thresholds": None
            } if system_type in ("fraud", "full") else None,
        }

    def predict_raw(self, db: Session, model_id: str, input_data: dict):
        """
        Raw prediction without policy/decision logic.
        """
        # 1. Load Model
        model = db.query(MLModel).filter(MLModel.id == model_id).first()
        if not model:
            raise ValueError(f"Model {model_id} not found")
            
        clf = self._load_model(model)
        
        # 2. Prepare Input (MVP: same as make_decision)
        df = pd.DataFrame([input_data])
        if hasattr(clf, "feature_names_in_"):
            required_cols = clf.feature_names_in_
            df = df.reindex(columns=required_cols, fill_value=0)
            
        # 3. Score
        score = clf.predict_proba(df)[0][1]
        
        return {
            "model_id": model.id,
            "score": float(score),
            "timestamp": pd.Timestamp.utcnow().isoformat()
        }

decision_service = DecisionService()
