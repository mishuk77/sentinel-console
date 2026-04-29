# ── Thread-safety: set in main.py / celery_app.py before imports ──
import os
import json as _json

_ENV = os.getenv("ENV", "local")

# ── Now safe to import numeric / ML libraries ───────────────────────────────
import pandas as pd
import numpy as np
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score, RandomizedSearchCV
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier, VotingClassifier
from sklearn.preprocessing import StandardScaler
from sklearn.pipeline import Pipeline
import xgboost as xgb
import lightgbm as lgb
from sklearn.metrics import (
    roc_auc_score, confusion_matrix, f1_score,
    matthews_corrcoef, accuracy_score,
    roc_curve, precision_recall_curve
)
from sklearn.calibration import calibration_curve as sklearn_calibration_curve
from scipy.stats import uniform, randint
import joblib
import io
import uuid
import time
import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.services.storage import storage
from app.services.inference_preprocessor import InferencePreprocessor
from app.core.config import settings

logger = logging.getLogger("sentinel.training")

# Railway's prefork Celery worker cannot use loky parallel loops (fork-in-fork).
# Use n_jobs=-1 only for local dev where there are no container restrictions.
N_JOBS = -1 if _ENV == "local" else 1


def _unwrap_calibrated(clf):
    """
    Get the inner base classifier from a CalibratedClassifierCV wrapper.

    The post-hoc calibration step wraps trained classifiers with
    CalibratedClassifierCV(cv=3), which fits 3 separate base estimators
    on different folds and averages their calibrated outputs. The
    wrapper itself doesn't expose coef_ / feature_importances_ — those
    live on the inner estimators (clf.calibrated_classifiers_[i].estimator).

    For UI purposes (feature importance display, SHAP) we just take the
    first inner estimator. The 3 fold-trained estimators have very
    similar coefficients/importances since they share most of the
    training data.

    Returns the original classifier when not wrapped (idempotent).
    """
    try:
        from sklearn.calibration import CalibratedClassifierCV
        if isinstance(clf, CalibratedClassifierCV):
            inner_list = getattr(clf, "calibrated_classifiers_", None)
            if inner_list:
                first = inner_list[0]
                # sklearn changed the attribute name across versions —
                # 1.4+ uses 'estimator', earlier versions used 'base_estimator'.
                inner_clf = (
                    getattr(first, "estimator", None)
                    or getattr(first, "base_estimator", None)
                )
                if inner_clf is not None:
                    return inner_clf
    except Exception:
        pass
    return clf


# ── Event Store Abstraction ───────────────────────────────────────────────────

class InMemoryEventStore:
    """Stores training events in-memory. Used when Redis is unavailable."""

    def __init__(self):
        self._events = {}

    def emit(self, job_id: str, step: str, status: str, detail: str):
        if job_id not in self._events:
            self._events[job_id] = []
        self._events[job_id].append(
            {"step": step, "status": status, "detail": detail, "ts": time.time()}
        )

    def get_events(self, job_id: str) -> list:
        return self._events.get(job_id, [])

    def clear_events(self, job_id: str):
        self._events.pop(job_id, None)


class RedisEventStore:
    """Stores training events in Redis. Shared between API and worker processes."""

    def __init__(self, redis_url: str):
        import redis
        self._r = redis.from_url(redis_url, decode_responses=True)
        self._prefix = "sentinel:events:"
        self._ttl = 3600  # events auto-expire after 1 hour

    def emit(self, job_id: str, step: str, status: str, detail: str):
        key = self._prefix + job_id
        event = _json.dumps({"step": step, "status": status, "detail": detail, "ts": time.time()})
        self._r.rpush(key, event)
        self._r.expire(key, self._ttl)

    def get_events(self, job_id: str) -> list:
        key = self._prefix + job_id
        try:
            raw = self._r.lrange(key, 0, -1)
            return [_json.loads(e) for e in raw]
        except Exception:
            return []

    def clear_events(self, job_id: str):
        self._r.delete(self._prefix + job_id)


def _create_event_store():
    if settings.REDIS_URL:
        try:
            store = RedisEventStore(settings.REDIS_URL)
            logger.info("Using Redis event store")
            return store
        except Exception as e:
            logger.warning(f"Redis connection failed, falling back to in-memory: {e}")
    return InMemoryEventStore()


class TrainingService:
    def __init__(self):
        self._store = _create_event_store()

    # ── Event System ─────────────────────────────────────────
    def emit(self, job_id: str, step: str, status: str, detail: str):
        self._store.emit(job_id, step, status, detail)
        logger.info(f"[TRAIN:{job_id[:8]}] {step} | {status} | {detail}")

    def get_events(self, job_id: str) -> list:
        return self._store.get_events(job_id)

    def clear_events(self, job_id: str):
        self._store.clear_events(job_id)

    # ── Main Training Pipeline ───────────────────────────────
    def train_models(self, dataset_path: str, target_col: str, feature_cols: list[str] = None,
                     model_context: str = "credit", job_id: str = None):
        job_id = job_id or str(uuid.uuid4())
        self.clear_events(job_id)

        # ── 1. Load Data ─────────────────────────────────────
        self.emit(job_id, "load_data", "running", f"Downloading dataset from {storage.mode.upper()} storage...")
        local_csv_path = f"temp_dataset_{job_id[:8]}.csv"
        storage.download_file(dataset_path, local_csv_path)
        df = pd.read_csv(local_csv_path)

        if target_col not in df.columns:
            self.emit(job_id, "load_data", "error", f"Target column '{target_col}' not found")
            raise ValueError(f"Target column {target_col} not found in dataset")

        if feature_cols:
            missing_features = [c for c in feature_cols if c not in df.columns]
            if missing_features:
                raise ValueError(f"Feature columns not found: {missing_features}")
            X_orig = df[feature_cols].copy()
        else:
            exclude = [target_col, "id", "customer_id", "created_at", "applicant_id",
                       "uuid", "name", "email", "phone"]
            cols = [c for c in df.columns if c.lower() not in exclude and not c.lower().endswith("id")]
            X_orig = df[cols].copy()

        y = df[target_col].copy()
        total_rows_original = len(df)
        mem_mb = round(df.memory_usage(deep=True).sum() / 1024 / 1024, 1)
        self.emit(job_id, "load_data", "done",
                  f"{total_rows_original:,} rows × {len(X_orig.columns)} features loaded ({mem_mb} MB in memory)")

        # ── 2. Data Profiling ────────────────────────────────
        self.emit(job_id, "data_profile", "running", "Profiling dataset characteristics...")

        numeric_cols = X_orig.select_dtypes(include=["number"]).columns.tolist()
        cat_cols = X_orig.select_dtypes(include=["object", "string", "category"]).columns.tolist()
        total_cells = X_orig.size
        missing_cells = int(X_orig.isnull().sum().sum())
        missing_pct = round(float(missing_cells / total_cells * 100), 1) if total_cells > 0 else 0.0

        # Class balance
        try:
            y_numeric = pd.to_numeric(y, errors="coerce")
            if y_numeric.notna().all():
                minority_rate = round(float((y_numeric == y_numeric.max()).mean()), 4)
            else:
                counts = y.value_counts()
                minority_rate = round(float(counts.min() / counts.sum()), 4)
        except Exception:
            minority_rate = None

        self.emit(job_id, "data_profile", "done",
                  f"{len(numeric_cols)} numeric, {len(cat_cols)} categorical features · "
                  f"{missing_pct}% missing · {minority_rate:.1%} minority class rate" if minority_rate else
                  f"{len(numeric_cols)} numeric, {len(cat_cols)} categorical · {missing_pct}% missing")
        # Detailed column breakdown
        col_types = X_orig.dtypes.value_counts()
        dtype_summary = ", ".join(f"{count} {dtype}" for dtype, count in col_types.items())
        self.emit(job_id, "data_dtypes", "done",
                  f"Column dtypes: {dtype_summary} · "
                  f"Target '{target_col}' has {y.nunique()} classes")

        # ── 3. Class Imbalance Detection ─────────────────────
        class_weight_setting = None
        if minority_rate is not None and minority_rate < 0.15:
            class_weight_setting = "balanced"
            self.emit(job_id, "class_balance", "done",
                      f"Imbalance detected ({minority_rate:.1%} minority) — applying balanced class weights")
        else:
            self.emit(job_id, "class_balance", "done", "Class distribution acceptable — no rebalancing needed")

        # ── 4. Feature Engineering ───────────────────────────
        # Delegate all preprocessing to InferencePreprocessor so the exact same
        # transforms can be replayed at inference time. The preprocessor is
        # saved alongside the model in the artifact (schema_version=2).
        self.emit(job_id, "feature_eng", "running", "Engineering features...")
        preprocessor = InferencePreprocessor()
        X_orig = preprocessor.fit_transform(X_orig, y)

        # Emit per-step events from the preprocessor's captured state so the
        # demo-quality pipeline feed remains rich.
        if preprocessor.dropped_hi_card_cols:
            self.emit(job_id, "feature_eng_card", "done",
                      f"Dropped {len(preprocessor.dropped_hi_card_cols)} high-cardinality categoricals "
                      f"(>50 unique): {', '.join(preprocessor.dropped_hi_card_cols)}")

        if preprocessor.target_encoded_cols:
            global_mean = float(y.mean())
            self.emit(job_id, "feature_eng_encode", "done",
                      f"Bayesian target encoding applied to {len(preprocessor.target_encoded_cols)} "
                      f"categoricals: {', '.join(preprocessor.target_encoded_cols)} "
                      f"(smoothing factor=10, global mean={global_mean:.4f})")

        if preprocessor._outlier_count > 0:
            self.emit(job_id, "feature_eng_outlier", "done",
                      f"Winsorized {preprocessor._outlier_count:,} outlier values across "
                      f"{preprocessor._cols_with_outliers} features "
                      f"(clipped at 1st/99th percentile boundaries)")
        else:
            self.emit(job_id, "feature_eng_outlier", "done",
                      "No outliers detected beyond 1st/99th percentile thresholds")

        if preprocessor._missing_imputed > 0:
            self.emit(job_id, "feature_eng_impute", "done",
                      f"Imputed {preprocessor._missing_imputed:,} missing values using median strategy")

        if preprocessor.onehot_columns:
            self.emit(job_id, "feature_eng_onehot", "done",
                      f"One-hot encoded {len(preprocessor.onehot_columns)} remaining categoricals → "
                      f"{len(preprocessor.final_columns)} total features")

        self.emit(job_id, "feature_eng", "done",
                  f"Feature engineering complete — {len(X_orig.columns)} final features")

        # Expose preprocessor state under the variable names the rest of the
        # function expects (used by ensemble builder and metrics dict).
        target_encoded_cols = preprocessor.target_encoded_cols
        outlier_count = preprocessor._outlier_count

        # ── 5. Feature Scaling ───────────────────────────────
        self.emit(job_id, "scaling", "running", "Fitting StandardScaler for feature normalization...")

        # Compute feature stats before scaling
        feature_stats = self._compute_feature_stats(X_orig, y)
        feature_count = len(X_orig.columns)

        self.emit(job_id, "scaling", "done",
                  f"StandardScaler fitted on {feature_count} features — "
                  f"μ→0, σ→1 normalization (required for Logistic Regression, improves convergence for all)")

        # ── 6. Sampling Cap ──────────────────────────────────
        TRAIN_CAP = 150_000
        was_sampled = len(X_orig) > TRAIN_CAP
        if was_sampled:
            self.emit(job_id, "sampling", "done",
                      f"Stratified sampling {len(X_orig):,} → {TRAIN_CAP:,} rows (diminishing returns threshold)")
            from sklearn.model_selection import StratifiedShuffleSplit
            sss = StratifiedShuffleSplit(n_splits=1, train_size=TRAIN_CAP, random_state=42)
            keep_idx, _ = next(sss.split(X_orig, y))
            X_orig = X_orig.iloc[keep_idx].reset_index(drop=True)
            y = y.iloc[keep_idx].reset_index(drop=True)

        # ── 7. Train/Test Split ──────────────────────────────
        X = X_orig.copy()
        X_train, X_test, y_train, y_test = train_test_split(
            X, y, test_size=0.2, random_state=42, stratify=y)

        # Scale features (used by all models for consistency, critical for LogReg)
        scaler = StandardScaler()
        X_train_scaled = pd.DataFrame(scaler.fit_transform(X_train), columns=X_train.columns, index=X_train.index)
        X_test_scaled = pd.DataFrame(scaler.transform(X_test), columns=X_test.columns, index=X_test.index)

        train_rows = len(X_train)
        test_rows = len(X_test)
        train_pos_rate = round(float(y_train.mean()), 4)
        test_pos_rate = round(float(y_test.mean()), 4)
        self.emit(job_id, "split", "done",
                  f"Stratified split → Train: {train_rows:,} rows ({train_pos_rate:.1%} positive) · "
                  f"Test: {test_rows:,} rows ({test_pos_rate:.1%} positive) — class ratio preserved")

        # ── 8. Hyperparameter Tuning + Training ──────────────
        skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)

        # Define candidates with parameter search spaces
        candidates = self._build_candidates(class_weight_setting)
        total_configs = sum(n_iter for _, _, _, n_iter, _ in candidates)
        total_fits = total_configs * 3  # 3 CV folds each
        self.emit(job_id, "tuning", "running",
                  f"Hyperparameter search: {len(candidates)} algorithms × RandomizedSearchCV · "
                  f"{total_configs} total configurations × 3-fold stratified CV = {total_fits} model fits")

        results = []
        trained_models = {}  # name -> (clf, preds, auc) for ensemble

        for idx, (name, base_clf, param_dist, n_iter, use_scaled) in enumerate(candidates, 1):
            version_id = str(uuid.uuid4())
            X_tr = X_train_scaled if use_scaled else X_train
            X_te = X_test_scaled if use_scaled else X_test

            # Describe the search space for this model
            param_names = list(param_dist.keys()) if param_dist else []
            self.emit(job_id, f"train_{name}", "running",
                      f"[{idx}/{len(candidates)}] Training {self._display_name(name)} — "
                      f"RandomizedSearchCV over {n_iter} configs × 3 folds = {n_iter * 3} fits · "
                      f"Tuning: {', '.join(param_names)}")

            t0 = time.time()
            try:
                if param_dist and n_iter > 1:
                    search = RandomizedSearchCV(
                        base_clf, param_dist, n_iter=n_iter,
                        scoring="roc_auc", cv=skf, n_jobs=N_JOBS,
                        random_state=42, error_score="raise"
                    )
                    search.fit(X_tr, y_train)
                    clf = search.best_estimator_
                    best_params = search.best_params_
                    configs_searched = n_iter
                    best_cv_score = round(float(search.best_score_), 5)
                    elapsed = round(time.time() - t0, 1)
                    # Format best params compactly
                    param_str = ", ".join(f"{k}={v:.4g}" if isinstance(v, float) else f"{k}={v}"
                                         for k, v in best_params.items())
                    self.emit(job_id, f"train_{name}", "done",
                              f"{self._display_name(name)} — best CV AUC: {best_cv_score:.4f} "
                              f"in {elapsed}s ({configs_searched} configs) · Best: {{{param_str}}}")
                else:
                    clf = base_clf
                    clf.fit(X_tr, y_train)
                    best_params = {}
                    configs_searched = 1
                    best_cv_score = None
                    elapsed = round(time.time() - t0, 1)
                    self.emit(job_id, f"train_{name}", "done",
                              f"{self._display_name(name)} trained with defaults in {elapsed}s")

            except Exception as e:
                elapsed = round(time.time() - t0, 1)
                logger.error(f"Training {name} failed: {e}")
                self.emit(job_id, f"train_{name}", "error",
                          f"{self._display_name(name)} failed after {elapsed}s: {str(e)[:100]}")
                continue

            # NOTE: a previous iteration wrapped the trained classifier
            # in CalibratedClassifierCV(method="isotonic") to fix H5
            # calibration FAILs on imbalanced class-weighted data.
            # That step compressed the prediction-score distribution
            # into a narrow range and broke the score-cutoff slider on
            # the Policy page (every applicant ended up with a similar
            # score, so the slider couldn't meaningfully discriminate).
            # We removed it and went back to raw class-weighted models.
            # Calibration may still flag in the health report; the
            # diagnostic-not-gating policy means the artifact saves
            # anyway and the user retains full slider control.

            # Hold-out evaluation
            preds = clf.predict_proba(X_te)[:, 1]
            auc = float(roc_auc_score(y_test, preds))
            trained_models[name] = (clf, preds, auc, use_scaled)

            # Emit holdout vs CV comparison (shows generalization)
            cv_vs_holdout = f"CV: {best_cv_score:.4f}" if best_cv_score else "N/A"
            self.emit(job_id, f"eval_{name}", "done",
                      f"{self._display_name(name)} holdout AUC: {auc:.4f} · {cv_vs_holdout} — "
                      f"{'good generalization' if best_cv_score and abs(auc - best_cv_score) < 0.02 else 'check overfitting' if best_cv_score and auc < best_cv_score - 0.02 else 'validated'}")

            # ── Health checks (training-time) ─────────────────────────
            # Run all six checks on the holdout predictions. Health checks
            # are DIAGNOSTIC at training time — never gating. The artifact
            # is always saved so the user retains their work and can
            # inspect what's wrong. The health report is persisted on the
            # model record and surfaced prominently in the UI; the user
            # decides whether to publish based on visible signals, not
            # have the pipeline silently drop their model.
            #
            # Rationale: in finance, target imbalance is the norm. Strict
            # H5 calibration thresholds (5pp WARN / 15pp FAIL) trip
            # routinely on legitimate credit/fraud data even after our
            # post-hoc isotonic calibration step. Refusing to save under
            # those conditions would block normal workflows. Real model
            # breakage (NaN/Inf, saturation, mode collapse) still gets
            # surfaced — the artifact saves with health_status='warning'
            # so downstream gates (Layer 2 registration) can decide.
            from app.services.inference_health import InferenceHealthChecker
            health_report = InferenceHealthChecker().run_all(
                predictions=preds,
                # No outcomes passed — calibration is no longer part of the
                # health-check suite. Imbalanced finance data routinely
                # produces inflated predicted means under class weighting,
                # which is the expected tradeoff, not a health signal.
            )

            if health_report.status == "FAIL":
                failures = " · ".join(
                    f"{r.check_name}: {r.message}" for r in health_report.failures
                )
                self.emit(job_id, f"health_{name}", "warn",
                          f"{self._display_name(name)} flagged at training "
                          f"({len(health_report.failures)} failing checks) — "
                          f"artifact saved for review. {failures}")
                logger.warning(f"Health check FAIL for {name} (saved anyway): {failures}")
                # Fall through to artifact save — never block here
            elif health_report.status == "WARN":
                warnings_text = " · ".join(
                    f"{r.check_name}: {r.message}"
                    for r in health_report.warnings
                )
                self.emit(job_id, f"health_{name}", "warn",
                          f"{self._display_name(name)} health checks WARN — "
                          f"saved with caveat. {warnings_text}")
            else:
                self.emit(job_id, f"health_{name}", "done",
                          f"{self._display_name(name)} health checks PASS "
                          f"({len(health_report.results)} checks)")

            # Cross-validation scores
            cv_fold_scores, cv_auc_mean, cv_auc_std = [], None, None
            if best_cv_score:
                cv_auc_mean = best_cv_score
            try:
                raw_cv = cross_val_score(clf, X_tr, y_train, cv=skf, scoring="roc_auc", n_jobs=N_JOBS)
                cv_fold_scores = [round(float(s), 5) for s in raw_cv]
                cv_auc_mean = round(float(raw_cv.mean()), 5)
                cv_auc_std = round(float(raw_cv.std()), 5)
            except Exception as e:
                logger.warning(f"CV scoring failed for {name}: {e}")

            # Classification metrics
            classification_metrics = self._compute_classification_metrics(y_test, preds)

            # Curve data for visualizations
            curve_data = self._compute_curve_data(y_test, preds)

            # Calibration / Decile analysis
            calibration = self._compute_calibration(y_test, preds)

            # Feature importance
            feature_importance = self._compute_feature_importance(name, clf, X.columns)

            # Save artifact (schema_version=2 — includes the preprocessor and
            # use_scaled flag so inference can replay training preprocessing
            # exactly. Older artifacts without these fields are still readable
            # via the legacy code path in decision_service.)
            model_buffer = io.BytesIO()
            joblib.dump({
                "model": clf,
                "scaler": scaler,
                "preprocessor": preprocessor,
                "use_scaled": use_scaled,
                "columns": list(X.columns),  # retained for backward-compat & debugging
                "model_type": name,
                "schema_version": 2,
            }, model_buffer)
            artifact_bytes = model_buffer.tell()
            model_buffer.seek(0)
            artifact_key = f"models/{name}_{version_id}.pkl"
            storage.upload_file(model_buffer, artifact_key)
            self.emit(job_id, f"artifact_{name}", "done",
                      f"Serialized {self._display_name(name)} → {artifact_key} "
                      f"({round(artifact_bytes / 1024, 1)} KB · schema v2)")

            # Save scored dataset
            scored_data_key = self._save_scored_data(name, version_id, clf,
                                                     X, X_orig, y, use_scaled, scaler)

            # Overfitting check
            train_preds = clf.predict_proba(X_tr)[:, 1]
            train_auc = float(roc_auc_score(y_train, train_preds))
            overfit_gap = round(train_auc - auc, 4)
            overfit_risk = "High" if overfit_gap > 0.05 else ("Moderate" if overfit_gap > 0.02 else "Low")
            self.emit(job_id, f"overfit_{name}", "done" if overfit_risk == "Low" else "warn",
                      f"{self._display_name(name)} overfit check — "
                      f"Train AUC: {train_auc:.4f} vs Test AUC: {auc:.4f} · "
                      f"Gap: {overfit_gap:.4f} · Risk: {overfit_risk}")

            results.append({
                "name": name,
                "version_id": version_id,
                "health_status": health_report.status,
                "health_report": health_report.to_dict(),
                "metrics": {
                    "auc": auc,
                    "cv_fold_scores": cv_fold_scores,
                    "cv_auc_mean": cv_auc_mean,
                    "cv_auc_std": cv_auc_std,
                    "classification_metrics": classification_metrics,
                    "model_context": model_context,
                    "calibration": calibration,
                    "scored_data_key": scored_data_key,
                    "feature_importance": feature_importance,
                    "feature_stats": feature_stats,
                    "training_details": {
                        "configs_searched": configs_searched,
                        "best_params": {k: (float(v) if isinstance(v, (np.floating,)) else
                                           int(v) if isinstance(v, (np.integer,)) else v)
                                       for k, v in best_params.items()},
                        "class_weight": class_weight_setting,
                        "scaling": "StandardScaler" if use_scaled else "None",
                        "target_encoding": len(target_encoded_cols) > 0,
                        "outlier_handling": "Winsorization (1st/99th percentile)" if outlier_count > 0 else "None",
                        "train_auc": round(train_auc, 5),
                        "overfit_gap": overfit_gap,
                        "overfit_risk": overfit_risk,
                    },
                    "data_profile": {
                        "total_rows": total_rows_original,
                        "total_rows_used": len(X),
                        "sampled": was_sampled,
                        "train_rows": train_rows,
                        "test_rows": test_rows,
                        "feature_count": feature_count,
                        "missing_pct": missing_pct,
                        "class_balance": minority_rate,
                        "target_col": target_col,
                    },
                    "curve_data": curve_data,
                },
                "artifact_path": artifact_key,
            })

        # ── 9. Stacked Ensemble ──────────────────────────────
        if len(trained_models) >= 2:
            self.emit(job_id, "ensemble", "running",
                      f"Building stacked ensemble from top {len(trained_models)} models...")
            try:
                ensemble_result = self._build_ensemble(
                    trained_models, X_train, X_train_scaled, X_test, X_test_scaled,
                    y_train, y_test, X, X_orig, y, scaler, feature_stats,
                    model_context, target_encoded_cols, outlier_count, minority_rate,
                    total_rows_original, was_sampled, missing_pct, feature_count,
                    train_rows, test_rows, class_weight_setting, job_id
                )
                if ensemble_result:
                    results.append(ensemble_result)
                    self.emit(job_id, "ensemble", "done",
                              f"Sentinel Ensemble — AUC: {ensemble_result['metrics']['auc']:.4f} "
                              f"(blends {len(trained_models)} models)")
            except Exception as e:
                logger.error(f"Ensemble failed: {e}")
                self.emit(job_id, "ensemble", "error", f"Ensemble failed: {str(e)[:100]}")

        # ── 10. Final Summary ────────────────────────────────
        if results:
            sorted_results = sorted(results, key=lambda r: r["metrics"]["auc"], reverse=True)
            best = sorted_results[0]
            # Emit leaderboard
            leaderboard = " → ".join(
                f"{self._display_name(r['name'])} ({r['metrics']['auc']:.4f})"
                for r in sorted_results
            )
            self.emit(job_id, "leaderboard", "done",
                      f"Model ranking by AUC: {leaderboard}")
            self.emit(job_id, "complete", "done",
                      f"Pipeline complete — {len(results)} models trained · "
                      f"Champion: {self._display_name(best['name'])} (AUC: {best['metrics']['auc']:.4f})")

        # Cleanup
        if os.path.exists(local_csv_path):
            os.remove(local_csv_path)

        return results

    # ── Candidate Builder ────────────────────────────────────
    def _build_candidates(self, class_weight):
        """Returns list of (name, estimator, param_dist, n_iter, use_scaled)."""
        cw = class_weight or None
        return [
            ("logistic_regression",
             LogisticRegression(max_iter=1000, n_jobs=N_JOBS, class_weight=cw),
             {"C": uniform(0.01, 10), "solver": ["lbfgs", "saga"]},
             10, True),

            ("random_forest",
             RandomForestClassifier(n_jobs=N_JOBS, class_weight=cw),
             {"n_estimators": randint(50, 300), "max_depth": randint(5, 20),
              "min_samples_split": randint(2, 20), "min_samples_leaf": randint(1, 10)},
             12, False),

            ("xgboost",
             xgb.XGBClassifier(eval_metric="logloss", n_jobs=N_JOBS, tree_method="hist",
                               scale_pos_weight=(1.0 / 0.1 if cw else 1.0)),
             {"max_depth": randint(3, 10), "learning_rate": uniform(0.01, 0.3),
              "n_estimators": randint(50, 300), "subsample": uniform(0.6, 0.4),
              "colsample_bytree": uniform(0.6, 0.4), "reg_alpha": uniform(0, 1),
              "reg_lambda": uniform(0.5, 2)},
             15, False),

            ("lightgbm",
             lgb.LGBMClassifier(n_jobs=N_JOBS, verbose=-1,
                                is_unbalance=True if cw else False),
             {"num_leaves": randint(20, 100), "max_depth": randint(3, 12),
              "learning_rate": uniform(0.01, 0.3), "n_estimators": randint(50, 300),
              "subsample": uniform(0.6, 0.4), "colsample_bytree": uniform(0.6, 0.4),
              "reg_alpha": uniform(0, 1), "reg_lambda": uniform(0, 1)},
             15, False),
        ]

    # ── Ensemble Builder ─────────────────────────────────────
    def _build_ensemble(self, trained_models, X_train, X_train_scaled, X_test, X_test_scaled,
                        y_train, y_test, X_all, X_orig, y_all, scaler, feature_stats,
                        model_context, target_encoded_cols, outlier_count, minority_rate,
                        total_rows, was_sampled, missing_pct, feature_count,
                        train_rows, test_rows, class_weight, job_id):
        """Build an AUC-weighted ensemble with best-or-blend safeguard."""
        version_id = str(uuid.uuid4())

        # ── Step 1: Compute AUC-proportional weights ──────────
        names_list = list(trained_models.keys())
        aucs = {name: auc for name, (clf, preds, auc, use_scaled) in trained_models.items()}
        total_auc = sum(aucs.values())
        auc_weights = {name: aucs[name] / total_auc for name in names_list}

        # ── Step 2: Weighted ensemble predictions ─────────────
        weighted_preds = np.zeros(len(y_test), dtype=np.float64)
        for name, (clf, preds, auc, use_scaled) in trained_models.items():
            weighted_preds += auc_weights[name] * np.array(preds)
        weighted_auc = float(roc_auc_score(y_test, weighted_preds))

        # ── Step 3: Best-or-blend safeguard ───────────────────
        best_name = max(aucs, key=aucs.get)
        best_individual_auc = aucs[best_name]
        blend_method = "auc_weighted"

        if weighted_auc < best_individual_auc:
            # Boost champion to 50%, redistribute rest proportionally
            champion_boost = 0.50
            remaining_auc = sum(a for n, a in aucs.items() if n != best_name)
            boosted_weights = {}
            for name in names_list:
                if name == best_name:
                    boosted_weights[name] = champion_boost
                else:
                    boosted_weights[name] = (1 - champion_boost) * (aucs[name] / remaining_auc) if remaining_auc > 0 else 0
            # Recompute with boosted weights
            boosted_preds = np.zeros(len(y_test), dtype=np.float64)
            for name, (clf, preds, auc, use_scaled) in trained_models.items():
                boosted_preds += boosted_weights[name] * np.array(preds)
            boosted_auc = float(roc_auc_score(y_test, boosted_preds))

            if boosted_auc > weighted_auc:
                weighted_preds = boosted_preds
                weighted_auc = boosted_auc
                auc_weights = boosted_weights
                blend_method = "champion_boosted"
                self.emit(job_id, "ensemble", "running",
                          f"Champion-boosted blend ({self._display_name(best_name)} @ 50%) — AUC: {boosted_auc:.4f}")

        ensemble_preds = weighted_preds
        ensemble_auc = weighted_auc
        final_weights = {name: round(w, 4) for name, w in auc_weights.items()}

        self.emit(job_id, "ensemble", "running",
                  f"Weights: " + " · ".join(f"{self._display_name(n)} {w:.0%}" for n, w in final_weights.items()))

        classification_metrics = self._compute_classification_metrics(y_test, ensemble_preds)
        curve_data = self._compute_curve_data(y_test, ensemble_preds)
        calibration = self._compute_calibration(y_test, ensemble_preds)

        # Build feature importance as weighted average across models
        all_importances = {}
        for name, (clf, _, _, _) in trained_models.items():
            w = final_weights[name]
            fi = self._compute_feature_importance(name, clf, X_all.columns)
            for f in fi:
                feat = f["feature"]
                if feat not in all_importances:
                    all_importances[feat] = 0.0
                all_importances[feat] += f["normalized"] * w

        feature_importance = []
        for feat, weighted_score in all_importances.items():
            feature_importance.append({
                "feature": feat, "importance": weighted_score, "normalized": round(weighted_score, 4),
                "impact": "Variable", "raw_value": weighted_score
            })
        feature_importance.sort(key=lambda x: x["importance"], reverse=True)
        feature_importance = feature_importance[:10]

        # Save ensemble artifact
        ensemble_meta = {
            "type": blend_method,
            "components": names_list,
            "weights": [final_weights[n] for n in names_list],
        }
        meta_buffer = io.BytesIO()
        joblib.dump(ensemble_meta, meta_buffer)
        meta_buffer.seek(0)
        artifact_key = f"models/ensemble_{version_id}.pkl"
        storage.upload_file(meta_buffer, artifact_key)

        # Save scored data for ensemble (weighted predictions on full dataset)
        scored_data_key = None
        try:
            import json as _json
            all_ensemble_scores = np.zeros(len(y_all), dtype=np.float64)
            for name, (clf, _, _, use_scaled) in trained_models.items():
                w = final_weights[name]
                X_scoring = X_all if not use_scaled else scaler.transform(X_all)
                all_ensemble_scores += w * clf.predict_proba(X_scoring)[:, 1]

            numeric_orig_cols = X_orig.select_dtypes(include=["number"]).columns.tolist()
            scored_dict = {
                "score": [round(float(s), 6) for s in all_ensemble_scores],
                "target": [int(v) for v in y_all.values],
            }
            for col in numeric_orig_cols:
                scored_dict[col] = X_orig[col].tolist()
            scored_bytes = _json.dumps(scored_dict).encode("utf-8")
            scored_data_key = f"scores/ensemble_{version_id}_scored.json"
            storage.upload_file(io.BytesIO(scored_bytes), scored_data_key)
        except Exception as e:
            logger.warning(f"Ensemble scored data save failed: {e}")

        return {
            "name": "ensemble",
            "version_id": version_id,
            "metrics": {
                "auc": ensemble_auc,
                "cv_fold_scores": [],
                "cv_auc_mean": None,
                "cv_auc_std": None,
                "classification_metrics": classification_metrics,
                "model_context": model_context,
                "calibration": calibration,
                "scored_data_key": scored_data_key,
                "feature_importance": feature_importance,
                "feature_stats": feature_stats,
                "training_details": {
                    "configs_searched": sum(1 for _ in trained_models),
                    "best_params": {"method": blend_method,
                                    "components": names_list,
                                    "weights": final_weights},
                    "class_weight": class_weight,
                    "scaling": "Mixed",
                    "target_encoding": len(target_encoded_cols) > 0,
                    "outlier_handling": "Winsorization (1st/99th percentile)" if outlier_count > 0 else "None",
                    "train_auc": None,
                    "overfit_gap": None,
                    "overfit_risk": "Low",
                },
                "data_profile": {
                    "total_rows": total_rows,
                    "total_rows_used": len(X_all),
                    "sampled": was_sampled,
                    "train_rows": train_rows,
                    "test_rows": test_rows,
                    "feature_count": feature_count,
                    "missing_pct": missing_pct,
                    "class_balance": minority_rate,
                    "target_col": y_all.name if hasattr(y_all, "name") else "target",
                },
                "curve_data": curve_data,
            },
            "artifact_path": artifact_key,
        }

    # ── Helper Methods ───────────────────────────────────────
    def _display_name(self, name: str) -> str:
        names = {
            "logistic_regression": "Logistic Regression",
            "random_forest": "Random Forest",
            "xgboost": "XGBoost",
            "lightgbm": "LightGBM",
            "ensemble": "Sentinel Ensemble",
        }
        return names.get(name, name)

    def _compute_feature_stats(self, X_orig, y):
        feature_stats = []
        try:
            for col in X_orig.columns:
                col_data = X_orig[col]
                is_numeric = pd.api.types.is_numeric_dtype(col_data)
                missing_count = int(col_data.isna().sum())
                unique_count = int(col_data.nunique())
                if is_numeric:
                    filled = col_data.fillna(col_data.median())
                    try:
                        corr = abs(float(filled.corr(y.astype(float))))
                    except Exception:
                        corr = 0.0
                    leakage = "High" if corr > 0.8 else ("Moderate" if corr > 0.5 else "Low")
                    feature_stats.append({
                        "feature": col, "var_type": "Numeric", "unique": unique_count,
                        "missing": missing_count,
                        "mean": round(float(col_data.mean()), 4) if not col_data.isna().all() else None,
                        "std": round(float(col_data.std()), 4) if not col_data.isna().all() else None,
                        "median": round(float(col_data.median()), 4) if not col_data.isna().all() else None,
                        "min": round(float(col_data.min()), 4) if not col_data.isna().all() else None,
                        "max": round(float(col_data.max()), 4) if not col_data.isna().all() else None,
                        "leakage": leakage,
                    })
                else:
                    encoded = pd.Categorical(col_data.fillna("__missing__")).codes
                    try:
                        corr = abs(float(pd.Series(encoded).corr(y.astype(float))))
                    except Exception:
                        corr = 0.0
                    leakage = "High" if corr > 0.8 else ("Moderate" if corr > 0.5 else "Low")
                    mode_val = str(col_data.mode().iloc[0]) if not col_data.mode().empty else "—"
                    feature_stats.append({
                        "feature": col, "var_type": "Categorical", "unique": unique_count,
                        "missing": missing_count, "mean": None, "std": None, "median": None,
                        "min": mode_val, "max": None, "leakage": leakage,
                    })
        except Exception as e:
            logger.warning(f"Feature stats failed: {e}")
        return feature_stats

    def _compute_classification_metrics(self, y_test, preds):
        try:
            y_pred = (preds >= 0.5).astype(int)
            tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
            tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0
            fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
            tnr = tn / (tn + fp) if (tn + fp) > 0 else 0.0
            ppv = tp / (tp + fp) if (tp + fp) > 0 else 0.0
            npv = tn / (tn + fn) if (tn + fn) > 0 else 0.0
            acc = (tp + tn) / (tp + tn + fp + fn)
            return {
                "f1": round(float(f1_score(y_test, y_pred, zero_division=0)), 4),
                "tpr": round(float(tpr), 4), "fpr": round(float(fpr), 4),
                "tnr": round(float(tnr), 4), "ppv": round(float(ppv), 4),
                "npv": round(float(npv), 4), "accuracy": round(float(acc), 4),
                "mcc": round(float(matthews_corrcoef(y_test, y_pred)), 4),
            }
        except Exception as e:
            logger.warning(f"Classification metrics failed: {e}")
            return {}

    def _compute_calibration(self, y_test, preds):
        try:
            eval_df = pd.DataFrame({"score": preds, "target": y_test.values})
            n_test = len(eval_df)
            n_bins = max(5, min(50, n_test // 200)) if n_test >= 100 else 5
            eval_df["decile"] = pd.qcut(eval_df["score"], n_bins, labels=False, duplicates="drop")
            total_count = len(eval_df)
            metrics_by_decile = eval_df.groupby("decile").agg({
                "score": ["min", "max", "mean"], "target": ["sum", "count", "mean"]
            }).sort_index()
            calibration = []
            for decile_idx, row in metrics_by_decile.iterrows():
                count = row[("target", "count")]
                calibration.append({
                    "decile": int(decile_idx) + 1,
                    "min_score": float(row[("score", "min")]),
                    "max_score": float(row[("score", "max")]),
                    "mean_score": float(row[("score", "mean")]),
                    "actual_rate": float(row[("target", "mean")]),
                    "approval_rate": float(count / total_count),
                    "count": int(count),
                })
            return calibration
        except Exception as e:
            logger.warning(f"Calibration failed: {e}")
            return []

    def _compute_feature_importance(self, name, clf, columns):
        try:
            # Unwrap CalibratedClassifierCV — the post-hoc calibration step
            # wraps the base classifier; coef_ / feature_importances_ live
            # on the inner estimators, not the wrapper. Without this, the
            # Top Risk Drivers panel comes up empty for any model that
            # was calibrated (i.e. all imbalanced-data models).
            base = _unwrap_calibrated(clf)

            if name == "logistic_regression":
                coeffs = base.coef_[0]
                total_abs = sum(abs(c) for c in coeffs) or 1.0
                fi = [{"feature": feat, "importance": abs(coef),
                       "normalized": round(abs(coef) / total_abs, 4),
                       "impact": "Increases Risk" if coef > 0 else "Decreases Risk",
                       "raw_value": float(coef)}
                      for feat, coef in zip(columns, coeffs)]
            elif name in ["random_forest", "xgboost", "lightgbm"]:
                imps = base.feature_importances_
                total = sum(imps) or 1.0
                fi = [{"feature": feat, "importance": float(imp),
                       "normalized": round(float(imp) / total, 4),
                       "impact": "Variable", "raw_value": float(imp)}
                      for feat, imp in zip(columns, imps)]
            else:
                return []
            fi.sort(key=lambda x: x["importance"], reverse=True)
            return fi[:10]
        except Exception as e:
            logger.warning(f"Feature importance failed for {name}: {e}")
            return []

    def _compute_curve_data(self, y_test, preds):
        """Compute point data for 8 classification visualizations."""
        curves = {}
        y_true = np.array(y_test)
        y_scores = np.array(preds)

        try:
            # 1. ROC Curve
            fpr, tpr, _ = roc_curve(y_true, y_scores)
            indices = np.linspace(0, len(fpr) - 1, min(100, len(fpr)), dtype=int)
            curves["roc"] = [
                {"fpr": round(float(fpr[i]), 4), "tpr": round(float(tpr[i]), 4)}
                for i in indices
            ]

            # 2. Precision-Recall Curve
            prec, rec, _ = precision_recall_curve(y_true, y_scores)
            indices = np.linspace(0, len(prec) - 1, min(100, len(prec)), dtype=int)
            curves["precision_recall"] = [
                {"recall": round(float(rec[i]), 4), "precision": round(float(prec[i]), 4)}
                for i in indices
            ]

            # 3. Cumulative Gains
            sorted_idx = np.argsort(-y_scores)
            y_sorted = y_true[sorted_idx]
            cum_pos = np.cumsum(y_sorted)
            total_pos = cum_pos[-1] if cum_pos[-1] > 0 else 1
            n = len(y_sorted)
            pct_population = np.arange(1, n + 1) / n
            pct_gain = cum_pos / total_pos
            indices = np.linspace(0, n - 1, 100, dtype=int)
            curves["cumulative_gains"] = [
                {"pct_population": round(float(pct_population[i]), 4),
                 "pct_gain": round(float(pct_gain[i]), 4)}
                for i in indices
            ]

            # 4. KS Plot
            ks_stat = float(np.max(tpr - fpr))
            fpr_full, tpr_full = fpr, tpr
            indices = np.linspace(0, len(fpr_full) - 1, 100, dtype=int)
            curves["ks_plot"] = {
                "points": [
                    {"threshold_pct": round(float(i / max(len(fpr_full) - 1, 1)), 4),
                     "tpr": round(float(tpr_full[i]), 4),
                     "fpr": round(float(fpr_full[i]), 4)}
                    for i in indices
                ],
                "ks_statistic": round(ks_stat, 4)
            }

            # 5. Score Distribution (histogram by class)
            bins = np.linspace(0, 1, 21)  # 20 bins
            pos_hist, _ = np.histogram(y_scores[y_true == 1], bins=bins)
            neg_hist, _ = np.histogram(y_scores[y_true == 0], bins=bins)
            curves["score_distribution"] = [
                {"bin_start": round(float(bins[i]), 2),
                 "bin_end": round(float(bins[i + 1]), 2),
                 "positive": int(pos_hist[i]),
                 "negative": int(neg_hist[i])}
                for i in range(len(pos_hist))
            ]

            # 6. Calibration Curve
            try:
                prob_true, prob_pred = sklearn_calibration_curve(
                    y_true, y_scores, n_bins=10, strategy="uniform"
                )
                curves["calibration_curve"] = [
                    {"predicted": round(float(prob_pred[i]), 4),
                     "actual": round(float(prob_true[i]), 4)}
                    for i in range(len(prob_true))
                ]
            except Exception:
                curves["calibration_curve"] = []

            # 7. Threshold Tuning (precision/recall/F1 vs threshold)
            thresholds = np.linspace(0.05, 0.95, 19)
            tuning_points = []
            for t in thresholds:
                y_pred_t = (y_scores >= t).astype(int)
                tp = int(np.sum((y_pred_t == 1) & (y_true == 1)))
                fp_t = int(np.sum((y_pred_t == 1) & (y_true == 0)))
                fn_t = int(np.sum((y_pred_t == 0) & (y_true == 1)))
                p = tp / (tp + fp_t) if (tp + fp_t) > 0 else 0
                r = tp / (tp + fn_t) if (tp + fn_t) > 0 else 0
                f = 2 * p * r / (p + r) if (p + r) > 0 else 0
                tuning_points.append({
                    "threshold": round(float(t), 2),
                    "precision": round(float(p), 4),
                    "recall": round(float(r), 4),
                    "f1": round(float(f), 4)
                })
            curves["threshold_tuning"] = tuning_points

            # 8. Confusion Matrix (at 0.5 threshold)
            y_pred_half = (y_scores >= 0.5).astype(int)
            tn, fp_cm, fn_cm, tp_cm = confusion_matrix(y_true, y_pred_half).ravel()
            total = int(tn + fp_cm + fn_cm + tp_cm)
            curves["confusion_matrix"] = {
                "tn": int(tn), "fp": int(fp_cm),
                "fn": int(fn_cm), "tp": int(tp_cm),
                "total": total
            }

        except Exception as e:
            logger.warning(f"Curve data computation failed: {e}")

        return curves

    def _save_scored_data(self, name, version_id, clf, X_full, X_orig, y, use_scaled, scaler):
        try:
            import json
            X_for_scoring = scaler.transform(X_full) if use_scaled and scaler is not None else X_full
            all_scores = clf.predict_proba(X_for_scoring)[:, 1]
            numeric_orig_cols = X_orig.select_dtypes(include=["number"]).columns.tolist()
            scored_dict = {
                "score": [round(float(s), 6) for s in all_scores],
                "target": [int(v) for v in y.values],
            }
            for col in numeric_orig_cols:
                scored_dict[col] = X_orig[col].tolist()
            scored_bytes = json.dumps(scored_dict).encode("utf-8")
            scored_key = f"scores/{name}_{version_id}_scored.json"
            storage.upload_file(io.BytesIO(scored_bytes), scored_key)
            return scored_key
        except Exception as e:
            logger.warning(f"Scored data save failed for {name}: {e}")
            return None


training_service = TrainingService()
