"""
Shared pytest fixtures for the Sentinel backend test suite.

Fixtures:
    synthetic_credit_dataset      A small, realistic credit DataFrame with both
                                  numeric and categorical features (used to
                                  reproduce the LR inference bug).
    fitted_lr_model               An LR model fully trained through the real
                                  pipeline, ready for inference parity tests.
"""

from __future__ import annotations

import numpy as np
import pandas as pd
import pytest


@pytest.fixture
def synthetic_credit_dataset() -> pd.DataFrame:
    """
    Generate a deterministic synthetic credit dataset.

    Includes:
      - Numeric features with non-trivial distributions (income, dti, credit_age_months)
      - Categorical features that require target encoding (marital_status, employment_type)
      - One column intended for one-hot encoding (region — kept low cardinality)
      - A binary target (charge_off) with a ~10% base rate
      - An approved_amount column to test predicted-loss math later
      - An application_id column for traceability tests later

    Determinism: seeded so the same fixture produces the same DataFrame across
    test runs.
    """
    rng = np.random.default_rng(42)
    n = 600

    # Categorical features
    marital = rng.choice(
        ["married", "single", "divorced", "widowed"],
        size=n,
        p=[0.55, 0.35, 0.08, 0.02],
    )
    employment = rng.choice(
        ["full_time", "self_employed", "part_time", "unemployed"],
        size=n,
        p=[0.7, 0.15, 0.1, 0.05],
    )
    region = rng.choice(["northeast", "south", "midwest", "west"], size=n)

    # Numeric features — generated so they have *real* signal for the target
    income = rng.lognormal(mean=10.8, sigma=0.4, size=n)  # ≈$50k median
    dti = rng.beta(2, 5, size=n)  # debt-to-income ratio in [0,1]
    credit_age_months = rng.gamma(shape=4, scale=24, size=n).astype(int)
    approved_amount = rng.lognormal(mean=8.5, sigma=0.5, size=n).round()

    # Build a target with genuine signal so a model can actually learn something.
    # Higher dti → higher default risk; longer credit history → lower risk;
    # unemployed → higher risk; lower income → higher risk.
    logit = (
        -3.0
        + 4.0 * dti
        - 0.001 * (income - 50_000) / 1000
        - 0.01 * credit_age_months
        + np.where(employment == "unemployed", 1.5, 0.0)
        + np.where(marital == "divorced", 0.4, 0.0)
    )
    prob = 1 / (1 + np.exp(-logit))
    target = rng.binomial(1, prob)

    df = pd.DataFrame(
        {
            "application_id": [f"APP{i:06d}" for i in range(n)],
            "income": income.round(2),
            "dti": dti.round(4),
            "credit_age_months": credit_age_months,
            "marital_status": marital,
            "employment_type": employment,
            "region": region,
            "approved_amount": approved_amount,
            "charge_off": target.astype(int),
        }
    )
    return df


@pytest.fixture
def feature_columns() -> list[str]:
    """The feature columns to use for training (excludes id, target, and amount)."""
    return [
        "income",
        "dti",
        "credit_age_months",
        "marital_status",
        "employment_type",
        "region",
    ]
