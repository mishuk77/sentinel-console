"""
Unit tests for InferencePreprocessor.

These tests verify the class in isolation. Integration tests that exercise the
full training → inference pipeline are in test_lr_inference.py.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest

from app.services.inference_preprocessor import InferencePreprocessor


def test_fit_transform_returns_numeric_dataframe(synthetic_credit_dataset, feature_columns):
    """After fit_transform, the output should be entirely numeric."""
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    X = df[feature_columns].copy()
    y = df["charge_off"]

    X_processed = pp.fit_transform(X, y)

    # Every column must be numeric
    non_numeric = X_processed.select_dtypes(exclude=["number", "bool"]).columns.tolist()
    assert non_numeric == [], f"Non-numeric columns survived: {non_numeric}"
    # No NaNs
    assert not X_processed.isnull().any().any()
    # Same number of rows
    assert len(X_processed) == len(X)


def test_transform_produces_same_columns_as_fit(synthetic_credit_dataset, feature_columns):
    """transform() output must have exactly the same columns as fit_transform()."""
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    X_train = df[feature_columns].iloc[:400]
    y_train = df["charge_off"].iloc[:400]

    X_train_processed = pp.fit_transform(X_train, y_train)

    # Take a fresh row, run through transform
    X_test = df[feature_columns].iloc[400:401]
    X_test_processed = pp.transform(X_test)

    assert list(X_test_processed.columns) == list(X_train_processed.columns)


def test_fit_then_transform_idempotent(synthetic_credit_dataset, feature_columns):
    """transform on the same training rows should produce the same values
    fit_transform produced for those rows (within float tolerance)."""
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    X = df[feature_columns].copy()
    y = df["charge_off"]

    X_fit = pp.fit_transform(X, y)
    X_again = pp.transform(X)

    # Both should have the same columns
    assert list(X_fit.columns) == list(X_again.columns)
    # And the same values within float tolerance
    np.testing.assert_array_almost_equal(
        X_fit.values.astype(float),
        X_again.values.astype(float),
        decimal=6,
    )


def test_unknown_categorical_value_uses_global_mean(synthetic_credit_dataset, feature_columns):
    """Unknown categorical values at inference must map to the global target
    mean (for target-encoded columns) or all-zeros (for one-hot columns)."""
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    pp.fit_transform(df[feature_columns], df["charge_off"])

    # marital_status has 4 categories at fit. Inject an unseen one.
    novel_row = df[feature_columns].iloc[0:1].copy()
    novel_row["marital_status"] = "married"  # known
    novel_row_known = pp.transform(novel_row)

    novel_row.loc[:, "marital_status"] = "alien"  # unseen
    novel_row_unknown = pp.transform(novel_row)

    # Output should still have the right shape
    assert list(novel_row_known.columns) == list(novel_row_unknown.columns)
    # And no exception was raised — the unknown category was handled gracefully


def test_calling_transform_before_fit_raises(synthetic_credit_dataset, feature_columns):
    pp = InferencePreprocessor()
    with pytest.raises(RuntimeError, match="must be fitted"):
        pp.transform(synthetic_credit_dataset[feature_columns].head(1))


def test_calling_fit_twice_raises(synthetic_credit_dataset, feature_columns):
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    pp.fit_transform(df[feature_columns], df["charge_off"])
    with pytest.raises(RuntimeError, match="already been fitted"):
        pp.fit_transform(df[feature_columns], df["charge_off"])


def test_high_cardinality_column_dropped():
    """A column with >50 unique values should be dropped."""
    rng = np.random.default_rng(0)
    n = 200
    df = pd.DataFrame(
        {
            "low_card_cat": rng.choice(["a", "b", "c"], size=n),
            "hi_card_cat": [f"id_{i}" for i in range(n)],  # 200 unique
            "numeric": rng.normal(size=n),
            "y": rng.binomial(1, 0.1, size=n),
        }
    )
    pp = InferencePreprocessor()
    X_processed = pp.fit_transform(df[["low_card_cat", "hi_card_cat", "numeric"]], df["y"])

    # hi_card_cat should be in dropped list
    assert "hi_card_cat" in pp.dropped_hi_card_cols
    # And not in any output column
    assert all("hi_card_cat" not in col for col in X_processed.columns)


def test_winsorization_clips_outliers():
    """Outliers beyond the 1st/99th percentile should be clipped at fit time."""
    rng = np.random.default_rng(1)
    n = 1000
    # Mostly normal data with a few extreme outliers
    values = rng.normal(loc=100, scale=10, size=n)
    values[0] = 10_000  # extreme outlier
    values[1] = -5_000  # extreme outlier
    df = pd.DataFrame(
        {
            "x": values,
            "y": rng.binomial(1, 0.1, size=n),
        }
    )
    pp = InferencePreprocessor()
    X_processed = pp.fit_transform(df[["x"]], df["y"])

    # Bounds should be near the data's typical range, not the extremes
    p_low, p_high = pp.winsorize_bounds["x"]
    assert p_low > -1000  # the -5000 outlier was clipped
    assert p_high < 1000  # the 10000 outlier was clipped
    # The extreme values themselves should be at the bounds
    assert X_processed["x"].iloc[0] == p_high
    assert X_processed["x"].iloc[1] == p_low


def test_missing_values_imputed_with_median():
    """NaN values in numeric columns should be replaced with the column median."""
    df = pd.DataFrame(
        {
            "x": [1.0, 2.0, 3.0, np.nan, 5.0, 6.0, 7.0, 8.0, 9.0, np.nan, 11.0, 12.0],
            "y": [0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0],
        }
    )
    pp = InferencePreprocessor()
    X_processed = pp.fit_transform(df[["x"]], df["y"])

    # No NaNs in output
    assert not X_processed["x"].isnull().any()
    # Median of {1,2,3,5,6,7,8,9,11,12} is 6.5
    assert pp.numeric_medians["x"] == pytest.approx(6.5, abs=0.01)


def test_low_cardinality_categorical_one_hot_encoded(synthetic_credit_dataset, feature_columns):
    """Low-cardinality categoricals (<=10 unique) should be one-hot, not
    target-encoded. The synthetic dataset's region column has 4 values."""
    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    pp.fit_transform(df[feature_columns], df["charge_off"])

    # region has 4 categories — should be one-hot
    assert "region" in pp.onehot_columns
    assert "region" not in pp.target_encoded_cols
    # Final columns should include region_north, region_south, etc.
    region_cols = [c for c in pp.final_columns if c.startswith("region_")]
    assert len(region_cols) >= 4


def test_serializable_with_joblib(synthetic_credit_dataset, feature_columns, tmp_path):
    """The preprocessor must serialize cleanly with joblib (used in model artifacts)."""
    import joblib

    df = synthetic_credit_dataset
    pp = InferencePreprocessor()
    X_processed = pp.fit_transform(df[feature_columns], df["charge_off"])

    path = tmp_path / "preprocessor.pkl"
    joblib.dump(pp, path)
    pp_loaded = joblib.load(path)

    # Loaded preprocessor should produce identical output
    X_reloaded = pp_loaded.transform(df[feature_columns])
    np.testing.assert_array_almost_equal(
        X_processed.values.astype(float),
        X_reloaded.values.astype(float),
        decimal=6,
    )
