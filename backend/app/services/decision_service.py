import pandas as pd
import numpy as np
import joblib
import io
import os
import logging
from sqlalchemy.orm import Session
from app.models.ml_model import MLModel, ModelStatus
from app.models.policy import Policy
from app.services.storage import storage
from app.services.loan_amount import loan_amount_service

logger = logging.getLogger("sentinel.inference")


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
        """
        Score a single model and return (score, prepared_df, classifier).

        Supports three artifact formats:

            * Schema v2 (current) — dict with model + preprocessor + scaler +
              use_scaled flag. The preprocessor replays training preprocessing
              identically (target encoding, winsorization, imputation, one-hot)
              and the scaler is only applied if use_scaled=True. This is the
              format produced by training.py from 2026-04 onward.

            * Schema v1 (legacy) — dict with model + scaler + columns. The
              preprocessor was missing and the scaler was applied
              unconditionally. This caused the LR saturation bug. We keep the
              code path so old artifacts still produce *some* output (with a
              warning), but a model registered with this format should be
              flagged as stale and re-trained.

            * Raw sklearn — a bare model with no preprocessing wrapper.
        """
        artifact = self._load_model(model)
        df = pd.DataFrame([input_data])
        algorithm = getattr(model, "algorithm", "unknown")

        # ─── Raw sklearn model (no preprocessing wrapper) ────────
        if hasattr(artifact, "predict_proba"):
            if hasattr(artifact, "feature_names_in_"):
                df = df.reindex(columns=artifact.feature_names_in_, fill_value=0)
            score = float(artifact.predict_proba(df)[0][1])
            self._log_inference(model, algorithm, input_data, df.values, None, score, schema="raw")
            return score, df, artifact

        if not isinstance(artifact, dict):
            raise ValueError(f"Unsupported artifact type: {type(artifact)}")

        # ─── Schema v2: preprocessor + scaler + use_scaled flag ───
        if artifact.get("schema_version") == 2 and "preprocessor" in artifact:
            clf = artifact["model"]
            preprocessor = artifact["preprocessor"]
            scaler = artifact.get("scaler")
            use_scaled = artifact.get("use_scaled", False)

            # Apply the SAME preprocessing the model saw at training time
            X_processed = preprocessor.transform(df)

            # Only apply the scaler if this specific model was trained on scaled
            # data (LogReg yes, tree models no). This was the second compounding
            # bug in the legacy code path — the scaler was applied to every
            # model regardless of whether it was trained on scaled features.
            if use_scaled and scaler is not None:
                X_final = pd.DataFrame(
                    scaler.transform(X_processed),
                    columns=X_processed.columns,
                    index=X_processed.index,
                )
            else:
                X_final = X_processed

            score = float(clf.predict_proba(X_final)[0][1])

            self._log_inference(
                model, algorithm, input_data,
                X_processed.values, X_final.values, score, schema="v2",
            )
            self._warn_if_saturated(model, algorithm, score)

            return score, X_final, clf

        # ─── Schema v1 (legacy): model + scaler + columns ────────
        if "model" in artifact:
            clf = artifact["model"]
            columns = artifact.get("columns")
            scaler = artifact.get("scaler")
            if columns:
                df = df.reindex(columns=columns, fill_value=0)
            elif hasattr(clf, "feature_names_in_"):
                df = df.reindex(columns=clf.feature_names_in_, fill_value=0)
            try:
                X = scaler.transform(df) if scaler is not None else df
            except Exception as e:
                logger.warning(
                    "Legacy artifact (model_id=%s, algo=%s) failed scaler.transform: %s. "
                    "Skipping scaler — predictions may be incorrect. Retrain to fix.",
                    model.id, algorithm, e,
                )
                X = df
            score = float(clf.predict_proba(X)[0][1])
            logger.warning(
                "Legacy schema-v1 artifact in use (model_id=%s, algo=%s, score=%.4f). "
                "Re-train this model to enable correct preprocessing replay.",
                model.id, algorithm, score,
            )
            self._warn_if_saturated(model, algorithm, score)
            return score, df, clf

        # ─── Ensemble meta artifact ──────────────────────────────
        if "components" in artifact and "weights" in artifact:
            component_names = artifact["components"]
            weights = artifact["weights"]
            ensemble_score = 0.0
            last_clf = None
            for name, w in zip(component_names, weights):
                comp_model = db.query(MLModel).filter(
                    MLModel.dataset_id == model.dataset_id,
                    MLModel.algorithm == name,
                    MLModel.artifact_path.isnot(None)
                ).order_by(MLModel.created_at.desc()).first()
                if not comp_model:
                    raise ValueError(f"Ensemble component '{name}' not found")
                comp_score, _, comp_clf = self._score_model(db, comp_model, input_data)
                ensemble_score += w * comp_score
                last_clf = comp_clf
            return float(ensemble_score), df, last_clf

        raise ValueError(f"Unrecognised artifact dict keys: {list(artifact.keys())}")

    def batch_score(self, db, model, input_rows):
        """
        Score many rows in a single call. Used by TASK-8 (Engine Backtest).

        For schema-v2 artifacts this uses preprocessor.transform on a full
        DataFrame at once, which is dramatically faster than per-row scoring.

        Also runs the saturation sanity check from TASK-1: if 90%+ of the batch
        falls above 0.95 OR below 0.05, log a WARNING with the batch size and
        model identifier. This catches model corruption that single-row
        inference can't detect (it looks normal one row at a time).
        """
        artifact = self._load_model(model)
        algorithm = getattr(model, "algorithm", "unknown")

        df = pd.DataFrame(input_rows) if not isinstance(input_rows, pd.DataFrame) else input_rows.copy()

        if isinstance(artifact, dict) and artifact.get("schema_version") == 2:
            preprocessor = artifact["preprocessor"]
            scaler = artifact.get("scaler")
            use_scaled = artifact.get("use_scaled", False)
            clf = artifact["model"]

            X_processed = preprocessor.transform(df)
            if use_scaled and scaler is not None:
                X_final = pd.DataFrame(
                    scaler.transform(X_processed),
                    columns=X_processed.columns,
                    index=X_processed.index,
                )
            else:
                X_final = X_processed

            scores = clf.predict_proba(X_final)[:, 1]
        else:
            # Legacy / fallback — score row-by-row
            scores = np.array([
                self._score_model(db, model, row)[0] for row in input_rows
            ])

        # TASK-1 acceptance criterion: runtime sanity check
        self._warn_if_batch_saturated(model, algorithm, scores)

        return scores

    def _log_inference(self, model, algorithm, input_data, processed_values,
                       scaled_values, score, schema):
        """DEBUG-level diagnostic logging for inference. Disabled in
        production by default; enable by setting log level to DEBUG."""
        if not logger.isEnabledFor(logging.DEBUG):
            return
        logger.debug(
            "[INFER schema=%s algo=%s model_id=%s] raw=%s processed=%s scaled=%s score=%.6f",
            schema, algorithm, getattr(model, "id", "?"),
            input_data, processed_values.tolist() if processed_values is not None else None,
            scaled_values.tolist() if scaled_values is not None else None,
            score,
        )

    def _warn_if_saturated(self, model, algorithm, score):
        """Per-row saturation warning. Single-row scores at 0.99999 or 0.00001
        are suspicious enough to log even without batch context."""
        if score > 0.999 or score < 0.001:
            logger.warning(
                "Saturated prediction: model_id=%s algo=%s score=%.6f. "
                "If many requests show this, the model may be broken.",
                getattr(model, "id", "?"), algorithm, score,
            )

    def _warn_if_batch_saturated(self, model, algorithm, scores):
        """TASK-1 batch sanity check: if 90%+ of a batch is above 0.95 OR below
        0.05, log a WARNING with batch ID. This catches model breakage that
        single-row inference can't detect."""
        n = len(scores)
        if n == 0:
            return
        scores = np.asarray(scores)
        high_frac = float((scores > 0.95).sum()) / n
        low_frac = float((scores < 0.05).sum()) / n
        if high_frac > 0.9 or low_frac > 0.9:
            batch_id = f"batch_{getattr(model, 'id', '?')[:8]}_{n}"
            logger.warning(
                "BATCH SATURATION batch_id=%s model_id=%s algo=%s n=%d "
                "high_frac=%.3f low_frac=%.3f. Model may be broken — investigate.",
                batch_id, getattr(model, "id", "?"), algorithm, n, high_frac, low_frac,
            )

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

    def _resolve_segment_threshold(self, db, policy, input_data):
        """
        TASK-4A: cascading segment policy logic.

        For each application:
            If application matches a segment AND that segment has a defined
            threshold (override_threshold or system-derived threshold):
                apply segment threshold
            Else:
                apply global policy threshold

        Multi-segment match: when an application matches multiple segments
        with custom thresholds, apply the MOST RESTRICTIVE (lowest) and log
        a warning so the user knows the configuration has an ambiguity.

        Returns (resolved_threshold, segment_label) where segment_label is
        either the name of the matched segment or None for global fallback.
        """
        from app.models.policy_segment import PolicySegment
        if not policy:
            return None, None

        segments = db.query(PolicySegment).filter(
            PolicySegment.policy_id == policy.id,
            PolicySegment.is_active == True,
            PolicySegment.is_global == False,
        ).all()

        matched = []
        for seg in segments:
            if seg.filters and self._matches_segment(seg.filters, input_data):
                # Use override threshold if set, else system-derived
                t = seg.override_threshold if seg.override_threshold is not None else seg.threshold
                if t is not None:
                    matched.append((seg, t))

        if not matched:
            return policy.threshold, None  # global fallback

        if len(matched) > 1:
            logger.warning(
                "Application matched %d segments with custom thresholds: %s. "
                "Applying most restrictive (lowest) threshold.",
                len(matched), [s.name for s, _ in matched],
            )

        # Most restrictive = lowest threshold (fewer applicants approved)
        seg, t = min(matched, key=lambda x: x[1])
        return t, seg.name

    def _matches_segment(self, filters: dict, input_data: dict) -> bool:
        """Check whether an applicant matches all filter conditions of a
        segment. Filters is a dict of {column: value} pairs (exact match).

        For range or set-based filters, the value can be a dict like
        {'op': '>=', 'value': 30} or {'op': 'in', 'values': [...]}.
        """
        if not filters:
            return True
        for col, expected in filters.items():
            actual = input_data.get(col)
            if isinstance(expected, dict) and "op" in expected:
                op = expected["op"]
                if op in (">=", "gte") and not (actual is not None and actual >= expected["value"]):
                    return False
                if op in ("<=", "lte") and not (actual is not None and actual <= expected["value"]):
                    return False
                if op == "in" and actual not in expected.get("values", []):
                    return False
                if op == "==" and actual != expected.get("value"):
                    return False
            else:
                if actual != expected:
                    return False
        return True

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

            # TASK-4A: cascading segment policy resolution. Apply segment
            # threshold if the applicant matches one with a custom cutoff;
            # otherwise fall back to the global policy threshold.
            resolved_threshold, matched_segment = self._resolve_segment_threshold(
                db, active_policy, input_data
            )
            effective_threshold = resolved_threshold if resolved_threshold is not None else active_policy.threshold

            # Credit Decision (Policy)
            result_str = "APPROVE" if credit_score < effective_threshold else "DECLINE"

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
                "cutoff": float(effective_threshold),
                "global_cutoff": float(active_policy.threshold),
                "score": float(credit_score),
                "matched_segment": matched_segment,  # None when global fallback
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
            
        # 2. Score using unified _score_model (handles all artifact types)
        score, _, _ = self._score_model(db, model, input_data)

        return {
            "model_id": model.id,
            "score": float(score),
            "timestamp": pd.Timestamp.utcnow().isoformat()
        }

decision_service = DecisionService()
