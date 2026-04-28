"""
InferencePreprocessor — captures every preprocessing transform applied during
training so inference can replay them identically.

Why this exists
---------------
Before this class, the training pipeline performed feature engineering inline
(target encoding, winsorization, imputation, one-hot encoding) but only saved
``{model, scaler, columns}`` in the artifact. Inference code reindexed raw
input rows to the saved columns and applied the scaler — which silently broke
for any dataset with categorical features. Logistic Regression saturated to
~0.99999 because raw category strings flowed through scaler.transform and
produced garbage logits; tree models absorbed the noise but trained on
unscaled data anyway.

This class fixes the bug at its root: the preprocessor itself is a serializable
artifact saved alongside the model. ``fit_transform`` runs during training and
captures every parameter needed to replay the transform; ``transform`` runs
during inference and produces a DataFrame whose columns and values exactly
match what the model saw at training time.

Stages (executed in this order, both at fit and transform time):

    1. Drop high-cardinality categoricals (>50 unique values at fit time)
    2. Target encoding for remaining categoricals (Bayesian smoothing)
    3. Winsorization of numeric features at the 1st/99th percentile
    4. Median imputation for missing numeric values
    5. One-hot encoding for any categoricals that survived target encoding
    6. Reindex to the final column list (drop extras, fill missing with 0)

Usage
-----
    pp = InferencePreprocessor()
    X_train_processed = pp.fit_transform(X_train, y_train)
    # ... train model on X_train_processed ...
    # ... save pp inside the model artifact ...

    # later, at inference:
    X_inference_processed = pp.transform(X_raw)
    score = model.predict_proba(X_inference_processed)[:, 1]

This class is intentionally stateless from the caller's perspective — calling
``transform`` mutates nothing on ``pp``. That property is required for safe
use in concurrent inference paths and in the TASK-8 backtest (which scores
many rows in a single call).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import numpy as np
import pandas as pd


# Configuration constants — these match what the training pipeline uses today
# and are pinned so a preprocessor fitted on an older codebase still produces
# identical output when loaded under a newer codebase.
_HI_CARDINALITY_THRESHOLD = 50
_TARGET_ENCODING_SMOOTHING = 10
_WINSORIZE_LOW = 0.01
_WINSORIZE_HIGH = 0.99


@dataclass
class InferencePreprocessor:
    """
    Captures all training-time preprocessing for replay at inference.

    Fields are populated by ``fit_transform`` and consumed by ``transform``.
    The class is dataclass-based so joblib can serialize it cleanly inside
    the model artifact dict.
    """

    # Captured during fit
    dropped_hi_card_cols: list[str] = field(default_factory=list)
    target_encoded_cols: list[str] = field(default_factory=list)
    target_encoding_maps: dict[str, dict[Any, float]] = field(default_factory=dict)
    target_encoding_globals: dict[str, float] = field(default_factory=dict)
    winsorize_bounds: dict[str, tuple[float, float]] = field(default_factory=dict)
    numeric_medians: dict[str, float] = field(default_factory=dict)
    onehot_columns: list[str] = field(default_factory=list)
    onehot_categories: dict[str, list[Any]] = field(default_factory=dict)
    final_columns: list[str] = field(default_factory=list)

    # Sentinel — set to True after fit_transform completes
    _fitted: bool = False

    # Outlier counts captured at fit (purely for diagnostic / event emission)
    _outlier_count: int = 0
    _cols_with_outliers: int = 0
    _missing_imputed: int = 0

    # Schema version of this preprocessor's serialization format. Bumped when
    # the preprocessing logic changes incompatibly so older artifacts can be
    # detected and handled with a migration shim.
    schema_version: int = 1

    # ─────────────────────────────────────────────────────────────────────
    # Public API
    # ─────────────────────────────────────────────────────────────────────

    def fit_transform(self, X: pd.DataFrame, y: pd.Series) -> pd.DataFrame:
        """
        Fit on training data and return the transformed DataFrame.

        Parameters
        ----------
        X : pd.DataFrame
            Raw feature DataFrame, one row per applicant. May contain a mix of
            numeric and categorical (object/string/category) columns.
        y : pd.Series
            Binary target aligned to ``X`` by index.

        Returns
        -------
        pd.DataFrame
            Fully preprocessed feature matrix ready to be passed to a model
            (or to a StandardScaler for linear models).
        """
        if self._fitted:
            raise RuntimeError(
                "InferencePreprocessor has already been fitted. Create a new "
                "instance for a new training run."
            )

        X = X.copy()
        global_target_mean = float(y.mean())

        # Step 1: Drop high-cardinality categoricals
        X = self._fit_drop_hi_cardinality(X)

        # Step 2: Target encoding (Bayesian smoothed) for remaining categoricals
        X = self._fit_target_encode(X, y, global_target_mean)

        # Step 3: Winsorize numeric features
        X = self._fit_winsorize(X)

        # Step 4: Median imputation
        X = self._fit_impute(X)

        # Step 5: One-hot encode any categoricals that survived target encoding
        X = self._fit_onehot(X)

        # Step 6: Capture the final column order
        self.final_columns = X.columns.tolist()
        self._fitted = True
        return X

    def transform(self, X: pd.DataFrame) -> pd.DataFrame:
        """
        Apply the fitted preprocessing to a raw feature DataFrame.

        Parameters
        ----------
        X : pd.DataFrame
            One or more rows of raw input features. Column names must match
            the columns present at fit time (extras are silently dropped;
            missing columns are filled with 0 after one-hot expansion).

        Returns
        -------
        pd.DataFrame
            DataFrame whose columns exactly match ``self.final_columns`` and
            whose values reflect every transform applied at fit time.

        Notes
        -----
        Unknown categorical values (categories not seen during training) are
        mapped to the global target mean for target-encoded columns and to
        all-zeros for one-hot-encoded columns. This is the conservative
        choice — predicting at the population average for novel categories.
        """
        if not self._fitted:
            raise RuntimeError(
                "InferencePreprocessor must be fitted before transform()"
            )

        X = X.copy()

        # Step 1: Drop high-cardinality columns (silently — they shouldn't
        # appear at inference but if they do, drop them).
        for col in self.dropped_hi_card_cols:
            if col in X.columns:
                X = X.drop(columns=[col])

        # Step 2: Target encoding
        for col in self.target_encoded_cols:
            if col not in X.columns:
                continue
            mapping = self.target_encoding_maps[col]
            global_mean = self.target_encoding_globals[col]
            X[col] = X[col].map(mapping).fillna(global_mean)

        # Step 3: Winsorize using the saved bounds
        for col, (p_low, p_high) in self.winsorize_bounds.items():
            if col in X.columns:
                X[col] = pd.to_numeric(X[col], errors="coerce")
                X[col] = X[col].clip(lower=p_low, upper=p_high)

        # Step 4: Median imputation
        for col, median in self.numeric_medians.items():
            if col in X.columns:
                X[col] = pd.to_numeric(X[col], errors="coerce")
                X[col] = X[col].fillna(median)

        # Step 5: One-hot encoding — must produce exactly the columns the
        # model was trained on. We restrict to known categories so that
        # unseen values produce all-zero one-hots (which is what reindex
        # below will enforce anyway, but being explicit avoids surprises).
        if self.onehot_columns:
            existing = [c for c in self.onehot_columns if c in X.columns]
            if existing:
                # Restrict each one-hot column to known categories so that
                # unseen values become NaN, then become all-zero one-hots
                # after pd.get_dummies (since dummy_na=False here — unknown
                # is a structural absence, not a separate category).
                for col in existing:
                    known = self.onehot_categories.get(col, [])
                    X[col] = X[col].where(X[col].isin(known), other=np.nan)
                X = pd.get_dummies(X, columns=existing, dummy_na=True)

        # Step 6: Reindex to the exact final column set. Missing columns
        # (e.g., one-hots for categories not present in this batch) become 0.
        # Extra columns (e.g., dummies for unseen categories that slipped
        # through) are dropped.
        X = X.reindex(columns=self.final_columns, fill_value=0)

        # Final guard: any remaining NaN becomes 0 (matches training behavior)
        X = X.fillna(0)
        return X

    # ─────────────────────────────────────────────────────────────────────
    # Internal fit helpers (kept private so the public surface stays small)
    # ─────────────────────────────────────────────────────────────────────

    def _fit_drop_hi_cardinality(self, X: pd.DataFrame) -> pd.DataFrame:
        cat_cols = X.select_dtypes(include=["object", "string", "category"]).columns.tolist()
        for col in cat_cols:
            if X[col].nunique() > _HI_CARDINALITY_THRESHOLD:
                self.dropped_hi_card_cols.append(col)
                X = X.drop(columns=[col])
        return X

    def _fit_target_encode(
        self, X: pd.DataFrame, y: pd.Series, global_mean: float
    ) -> pd.DataFrame:
        cat_cols = X.select_dtypes(include=["object", "string", "category"]).columns.tolist()
        # Only target-encode columns that *survive* the high-cardinality drop
        # AND whose cardinality justifies it. Very low-cardinality cols (<=10
        # unique) are reserved for one-hot encoding because target encoding
        # provides little benefit for such small category counts.
        for col in cat_cols:
            n_unique = X[col].nunique()
            if n_unique <= 10:
                # Skip — let the one-hot stage handle it
                continue
            stats = pd.DataFrame(
                {
                    "_y": y.values,
                    "_cat": X[col].values,
                }
            ).groupby("_cat")["_y"].agg(["mean", "count"])
            smooth = (
                stats["count"] * stats["mean"]
                + _TARGET_ENCODING_SMOOTHING * global_mean
            ) / (stats["count"] + _TARGET_ENCODING_SMOOTHING)

            self.target_encoding_maps[col] = {k: float(v) for k, v in smooth.to_dict().items()}
            self.target_encoding_globals[col] = global_mean
            self.target_encoded_cols.append(col)
            X[col] = X[col].map(smooth).fillna(global_mean).astype(float)
        return X

    def _fit_winsorize(self, X: pd.DataFrame) -> pd.DataFrame:
        for col in X.select_dtypes(include=["number"]).columns:
            col_data = X[col].dropna()
            if len(col_data) < 10:
                continue
            p_low = float(col_data.quantile(_WINSORIZE_LOW))
            p_high = float(col_data.quantile(_WINSORIZE_HIGH))
            if p_low == p_high:
                continue
            self.winsorize_bounds[col] = (p_low, p_high)
            n_outliers = int(((col_data < p_low) | (col_data > p_high)).sum())
            if n_outliers > 0:
                self._outlier_count += n_outliers
                self._cols_with_outliers += 1
            X[col] = X[col].clip(lower=p_low, upper=p_high)
        return X

    def _fit_impute(self, X: pd.DataFrame) -> pd.DataFrame:
        missing_before = int(X.isnull().sum().sum())
        for col in X.select_dtypes(include=["number"]).columns:
            median = float(X[col].median()) if X[col].notna().any() else 0.0
            self.numeric_medians[col] = median
            if X[col].isnull().any():
                X[col] = X[col].fillna(median)
        # Final NaN sweep (catches any non-numeric NaN that slipped through)
        X = X.fillna(0)
        self._missing_imputed = missing_before
        return X

    def _fit_onehot(self, X: pd.DataFrame) -> pd.DataFrame:
        remaining_obj = X.select_dtypes(include=["object", "string"]).columns.tolist()
        if not remaining_obj:
            return X
        for col in remaining_obj:
            self.onehot_categories[col] = sorted(
                X[col].dropna().unique().tolist(), key=str
            )
        self.onehot_columns = remaining_obj
        X = pd.get_dummies(X, columns=remaining_obj, dummy_na=True)
        return X

    # ─────────────────────────────────────────────────────────────────────
    # Diagnostic helpers — used by training.py to emit demo-quality events
    # ─────────────────────────────────────────────────────────────────────

    @property
    def feature_engineering_summary(self) -> dict:
        """Human-readable summary of what fit_transform did. Used by the
        training pipeline to emit pipeline events without re-implementing
        the descriptions inline."""
        return {
            "dropped_hi_cardinality": list(self.dropped_hi_card_cols),
            "target_encoded": list(self.target_encoded_cols),
            "target_encoding_smoothing": _TARGET_ENCODING_SMOOTHING,
            "outlier_count": self._outlier_count,
            "cols_with_outliers": self._cols_with_outliers,
            "missing_imputed": self._missing_imputed,
            "onehot_expanded_from": list(self.onehot_columns),
            "final_feature_count": len(self.final_columns),
        }
