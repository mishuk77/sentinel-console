import pandas as pd
from sklearn.model_selection import train_test_split, StratifiedKFold, cross_val_score
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
import xgboost as xgb
from sklearn.metrics import (
    roc_auc_score, confusion_matrix, f1_score,
    matthews_corrcoef, accuracy_score
)
import joblib
import os
import io
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from app.services.storage import storage

class TrainingService:
    def __init__(self):
        pass

    def train_models(self, dataset_path: str, target_col: str, feature_cols: list[str] = None, model_context: str = "credit"):
        # 1. Load Data
        print(f"Loading data from {dataset_path}")
        local_csv_path = "temp_dataset.csv"
        storage.download_file(dataset_path, local_csv_path)

        df = pd.read_csv(local_csv_path)

        if target_col not in df.columns:
            raise ValueError(f"Target column {target_col} not found in dataset")

        if feature_cols:
            missing_features = [c for c in feature_cols if c not in df.columns]
            if missing_features:
                raise ValueError(f"Feature columns not found: {missing_features}")
            X_orig = df[feature_cols].copy()
        else:
            exclude = [target_col, "id", "customer_id", "created_at", "applicant_id", "uuid", "name", "email", "phone"]
            cols = [c for c in df.columns if c.lower() not in exclude and not c.lower().endswith("id")]
            X_orig = df[cols].copy()

        y = df[target_col].copy()

        # Memory Safeguard: Drop High Cardinality Categoricals
        for col in X_orig.select_dtypes(include=['object', 'string']).columns:
            if X_orig[col].nunique() > 50:
                print(f"Dropping high cardinality column: {col}")
                X_orig = X_orig.drop(columns=[col])

        total_rows_original = len(df)

        # Training cap: stratified sample to keep memory and training time bounded.
        # Diminishing returns on model quality kick in well before 150k for tabular credit data.
        TRAIN_CAP = 150_000
        was_sampled = len(X_orig) > TRAIN_CAP
        if was_sampled:
            print(f"Dataset has {len(X_orig)} rows — stratified sampling to {TRAIN_CAP} for training.")
            from sklearn.model_selection import StratifiedShuffleSplit
            sss = StratifiedShuffleSplit(n_splits=1, train_size=TRAIN_CAP, random_state=42)
            keep_idx, _ = next(sss.split(X_orig, y))
            X_orig = X_orig.iloc[keep_idx].reset_index(drop=True)
            y = y.iloc[keep_idx].reset_index(drop=True)

        # Compute feature stats from original X before preprocessing
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
                    leakage = 'High' if corr > 0.8 else ('Moderate' if corr > 0.5 else 'Low')
                    feature_stats.append({
                        'feature':   col,
                        'var_type':  'Numeric',
                        'unique':    unique_count,
                        'missing':   missing_count,
                        'mean':      round(float(col_data.mean()), 4) if not col_data.isna().all() else None,
                        'std':       round(float(col_data.std()),  4) if not col_data.isna().all() else None,
                        'median':    round(float(col_data.median()), 4) if not col_data.isna().all() else None,
                        'min':       round(float(col_data.min()),  4) if not col_data.isna().all() else None,
                        'max':       round(float(col_data.max()),  4) if not col_data.isna().all() else None,
                        'leakage':   leakage,
                    })
                else:
                    encoded = pd.Categorical(col_data.fillna('__missing__')).codes
                    try:
                        corr = abs(float(pd.Series(encoded).corr(y.astype(float))))
                    except Exception:
                        corr = 0.0
                    leakage = 'High' if corr > 0.8 else ('Moderate' if corr > 0.5 else 'Low')
                    mode_val = str(col_data.mode().iloc[0]) if not col_data.mode().empty else '—'
                    feature_stats.append({
                        'feature':   col,
                        'var_type':  'Categorical',
                        'unique':    unique_count,
                        'missing':   missing_count,
                        'mean':      None,
                        'std':       None,
                        'median':    None,
                        'min':       mode_val,  # mode for categoricals
                        'max':       None,
                        'leakage':   leakage,
                    })
        except Exception as e:
            print(f"Feature stats failed: {e}")
            feature_stats = []

        # Compute data profile stats before preprocessing
        feature_count = len(X_orig.columns)
        total_rows_used = total_rows_original
        total_cells = X_orig.size
        missing_cells = int(X_orig.isnull().sum().sum())
        missing_pct = round(float(missing_cells / total_cells * 100), 1) if total_cells > 0 else 0.0
        try:
            y_numeric = pd.to_numeric(y, errors="coerce")
            if y_numeric.notna().all():
                class_balance = round(float((y_numeric == y_numeric.max()).mean()), 4)
            else:
                counts = y.value_counts()
                minority = counts.idxmin()
                class_balance = round(float((y == minority).mean()), 4)
        except Exception:
            class_balance = None

        # Preprocessing
        X = pd.get_dummies(X_orig, dummy_na=True)
        X = X.fillna(0)

        # Split
        X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=y)

        train_rows = len(X_train)
        test_rows = len(X_test)

        results = []

        # 2. Train Candidates
        candidates = [
            ("logistic_regression", LogisticRegression(max_iter=1000, n_jobs=-1)),
            ("random_forest", RandomForestClassifier(n_estimators=50, max_depth=10, n_jobs=-1)),
            ("xgboost", xgb.XGBClassifier(use_label_encoder=False, eval_metric='logloss', n_jobs=-1, max_depth=6))
        ]

        skf = StratifiedKFold(n_splits=3, shuffle=True, random_state=42)

        for name, clf in candidates:
            version_id = str(uuid.uuid4())
            print(f"Training {name}...")
            clf.fit(X_train, y_train)

            # Hold-out evaluation
            preds = clf.predict_proba(X_test)[:, 1]
            auc = float(roc_auc_score(y_test, preds))

            # 5-fold cross-validation scores
            cv_fold_scores = []
            cv_auc_mean = None
            cv_auc_std = None
            try:
                raw_cv = cross_val_score(clf, X_train, y_train, cv=skf, scoring='roc_auc', n_jobs=-1)
                cv_fold_scores = [round(float(s), 5) for s in raw_cv]
                cv_auc_mean = round(float(raw_cv.mean()), 5)
                cv_auc_std  = round(float(raw_cv.std()),  5)
            except Exception as e:
                print(f"CV scoring failed: {e}")

            # Confusion-matrix metrics at threshold=0.5
            classification_metrics = {}
            try:
                y_pred = (preds >= 0.5).astype(int)
                tn, fp, fn, tp = confusion_matrix(y_test, y_pred).ravel()
                tpr = tp / (tp + fn) if (tp + fn) > 0 else 0.0
                fpr = fp / (fp + tn) if (fp + tn) > 0 else 0.0
                tnr = tn / (tn + fp) if (tn + fp) > 0 else 0.0
                ppv = tp / (tp + fp) if (tp + fp) > 0 else 0.0
                npv = tn / (tn + fn) if (tn + fn) > 0 else 0.0
                acc = (tp + tn) / (tp + tn + fp + fn)
                f1  = f1_score(y_test, y_pred, zero_division=0)
                mcc = matthews_corrcoef(y_test, y_pred)
                classification_metrics = {
                    'f1':       round(float(f1),  4),
                    'tpr':      round(float(tpr), 4),
                    'fpr':      round(float(fpr), 4),
                    'tnr':      round(float(tnr), 4),
                    'ppv':      round(float(ppv), 4),
                    'npv':      round(float(npv), 4),
                    'accuracy': round(float(acc), 4),
                    'mcc':      round(float(mcc), 4),
                }
            except Exception as e:
                print(f"Classification metrics failed: {e}")

            # Calibration / Decile Analysis
            eval_df = pd.DataFrame({"score": preds, "target": y_test.values})
            calibration = []
            try:
                # Dynamic bins: ~200 obs per bin, capped 10–50, minimum 5
                n_test = len(eval_df)
                n_bins = max(5, min(50, n_test // 200)) if n_test >= 100 else 5
                eval_df["decile"] = pd.qcut(eval_df["score"], n_bins, labels=False, duplicates='drop')
                total_count = len(eval_df)
                metrics_by_decile = eval_df.groupby("decile").agg({
                    "score":  ["min", "max", "mean"],
                    "target": ["sum", "count", "mean"]
                }).sort_index()
                for decile_idx, row in metrics_by_decile.iterrows():
                    count = row[("target", "count")]
                    calibration.append({
                        "decile":       int(decile_idx) + 1,
                        "min_score":    float(row[("score", "min")]),
                        "max_score":    float(row[("score", "max")]),
                        "mean_score":   float(row[("score", "mean")]),
                        "actual_rate":  float(row[("target", "mean")]),
                        "approval_rate":float(count / total_count),
                        "count":        int(count)
                    })
            except Exception as e:
                print(f"Calibration failed: {e}")
                calibration = []

            # Feature Importance
            feature_importance = []
            try:
                if name == "logistic_regression":
                    coeffs = clf.coef_[0]
                    total_abs = sum(abs(c) for c in coeffs) or 1.0
                    for feat, coef in zip(X.columns, coeffs):
                        feature_importance.append({
                            "feature":    feat,
                            "importance": abs(coef),
                            "normalized": round(abs(coef) / total_abs, 4),
                            "impact":     "Increases Risk" if coef > 0 else "Decreases Risk",
                            "raw_value":  float(coef)
                        })
                elif name in ["random_forest", "xgboost"]:
                    imps = clf.feature_importances_
                    total = sum(imps) or 1.0
                    for feat, imp in zip(X.columns, imps):
                        feature_importance.append({
                            "feature":    feat,
                            "importance": float(imp),
                            "normalized": round(float(imp) / total, 4),
                            "impact":     "Variable",
                            "raw_value":  float(imp)
                        })
                feature_importance.sort(key=lambda x: x["importance"], reverse=True)
                feature_importance = feature_importance[:10]
            except Exception as e:
                print(f"Feature importance failed: {e}")
                feature_importance = []

            # Save Artifact
            model_buffer = io.BytesIO()
            joblib.dump(clf, model_buffer)
            model_buffer.seek(0)
            artifact_key = f"models/{name}_{version_id}.pkl"
            storage.upload_file(model_buffer, artifact_key)

            # Save Scored Dataset — all observations scored, with original numeric columns
            # Used by Exposure Control for on-demand risk × amount cross-tabulation
            scored_data_key = None
            try:
                all_scores = clf.predict_proba(X)[:, 1]
                numeric_orig_cols = X_orig.select_dtypes(include=["number"]).columns.tolist()
                scored_dict = {
                    "score":  [round(float(s), 6) for s in all_scores],
                    "target": [int(v) for v in y.values],
                }
                for col in numeric_orig_cols:
                    scored_dict[col] = X_orig[col].tolist()
                import json
                scored_bytes = json.dumps(scored_dict).encode("utf-8")
                scored_key = f"scores/{name}_{version_id}_scored.json"
                storage.upload_file(io.BytesIO(scored_bytes), scored_key)
                scored_data_key = scored_key
                print(f"Saved scored data: {scored_key} ({len(all_scores)} rows, {len(numeric_orig_cols)} numeric cols)")
            except Exception as e:
                print(f"Scored data save failed: {e}")

            results.append({
                "name":       name,
                "version_id": version_id,
                "metrics": {
                    "auc":                    auc,
                    "cv_fold_scores":         cv_fold_scores,
                    "cv_auc_mean":            cv_auc_mean,
                    "cv_auc_std":             cv_auc_std,
                    "classification_metrics": classification_metrics,
                    "model_context":          model_context,
                    "calibration":            calibration,
                    "scored_data_key":        scored_data_key,
                    "feature_importance":     feature_importance,
                    "feature_stats":          feature_stats,
                    "data_profile": {
                        "total_rows":      total_rows_original,
                        "total_rows_used": total_rows_used,
                        "sampled":         was_sampled,
                        "train_rows":      train_rows,
                        "test_rows":       test_rows,
                        "feature_count":   feature_count,
                        "missing_pct":     missing_pct,
                        "class_balance":   class_balance,
                        "target_col":      target_col,
                    },
                },
                "artifact_path": artifact_key
            })

        # Cleanup
        if os.path.exists(local_csv_path):
            os.remove(local_csv_path)

        return results

training_service = TrainingService()
