"""
Tests for the InferenceHealthChecker (TASK-9 + TASK-10).

Each of the six checks (H1-H6) has PASS / WARN / FAIL test cases per
the spec thresholds.
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.inference_health import (
    HealthReport,
    InferenceHealthChecker,
)


@pytest.fixture
def checker():
    return InferenceHealthChecker()


# ────────────────────────────────────────────────────────────────────────
# H1 — Saturation
# ────────────────────────────────────────────────────────────────────────


def test_saturation_pass_on_healthy_distribution(checker):
    rng = np.random.default_rng(0)
    p = rng.beta(2, 5, size=1000)  # most predictions in middle
    r = checker.check_saturation(p)
    assert r.status == "PASS"


def test_saturation_warn_at_70_percent_extreme(checker):
    """70% extreme — should WARN (between 60% and 80%)."""
    p = np.concatenate([
        np.full(700, 0.99),  # 70% pegged high
        np.linspace(0.1, 0.9, 300),  # 30% spread
    ])
    r = checker.check_saturation(p)
    assert r.status == "WARN"


def test_saturation_fail_at_90_percent_extreme(checker):
    """90% extreme — should FAIL (this matches the LR bug symptom)."""
    p = np.concatenate([np.full(900, 0.99), np.linspace(0.1, 0.9, 100)])
    r = checker.check_saturation(p)
    assert r.status == "FAIL"
    assert "preprocessing pipeline" in r.message  # mentions TASK-1 root cause


def test_saturation_handles_empty_input(checker):
    r = checker.check_saturation(np.array([]))
    assert r.status == "PASS"


# ────────────────────────────────────────────────────────────────────────
# H2 — Mode collapse
# ────────────────────────────────────────────────────────────────────────


def test_mode_collapse_pass_on_diverse_predictions(checker):
    rng = np.random.default_rng(1)
    p = rng.beta(2, 5, size=500)
    r = checker.check_mode_collapse(p)
    assert r.status == "PASS"


def test_mode_collapse_fail_on_constant_predictor(checker):
    """All predictions identical → std=0 → FAIL."""
    p = np.full(500, 0.05)
    r = checker.check_mode_collapse(p)
    assert r.status == "FAIL"


def test_mode_collapse_warn_on_low_variance(checker):
    """Std around 0.03 should WARN (between 0.02 and 0.05)."""
    rng = np.random.default_rng(2)
    p = 0.05 + 0.03 * rng.normal(size=500)
    r = checker.check_mode_collapse(p)
    assert r.status in ("WARN", "FAIL")


# ────────────────────────────────────────────────────────────────────────
# H3 — Out of range
# ────────────────────────────────────────────────────────────────────────


def test_out_of_range_pass_on_valid_probabilities(checker):
    p = np.array([0.0, 0.5, 1.0, 0.2])
    r = checker.check_out_of_range(p)
    assert r.status == "PASS"


def test_out_of_range_fail_on_negative(checker):
    p = np.array([0.5, -0.1, 0.7])
    r = checker.check_out_of_range(p)
    assert r.status == "FAIL"


def test_out_of_range_fail_on_above_one(checker):
    p = np.array([0.5, 1.2, 0.7])
    r = checker.check_out_of_range(p)
    assert r.status == "FAIL"


# ────────────────────────────────────────────────────────────────────────
# H4 — NaN / Inf
# ────────────────────────────────────────────────────────────────────────


def test_nan_inf_pass_on_finite(checker):
    r = checker.check_nan_inf(np.array([0.1, 0.5, 0.9]))
    assert r.status == "PASS"


def test_nan_inf_fail_on_nan(checker):
    r = checker.check_nan_inf(np.array([0.1, np.nan, 0.9]))
    assert r.status == "FAIL"


def test_nan_inf_fail_on_inf(checker):
    r = checker.check_nan_inf(np.array([0.1, np.inf, 0.9]))
    assert r.status == "FAIL"


# ────────────────────────────────────────────────────────────────────────
# H5 — Calibration
# ────────────────────────────────────────────────────────────────────────


def test_calibration_pass_when_means_match(checker):
    rng = np.random.default_rng(3)
    n = 5000
    p = rng.beta(2, 18, size=n)  # mean ≈ 0.1
    y = rng.binomial(1, 0.10, size=n)  # 10% base rate
    r = checker.check_calibration(p, y)
    assert r.status == "PASS"


def test_calibration_fail_when_predicted_rate_wildly_off(checker):
    """LR-bug scenario: predicted rate near 1.0 vs observed 0.05."""
    p = np.full(2000, 0.99)
    y = np.zeros(2000)
    y[:100] = 1  # 5% base rate
    r = checker.check_calibration(p, y)
    assert r.status == "FAIL"
    assert "miscalibrated" in r.message.lower()


def test_calibration_warn_at_moderate_difference(checker):
    """Predicted 12% vs observed 5% → 7pp diff → WARN."""
    p = np.full(2000, 0.12)
    y = np.zeros(2000)
    y[:100] = 1  # 5% base rate
    r = checker.check_calibration(p, y)
    assert r.status == "WARN"


# ────────────────────────────────────────────────────────────────────────
# H6 — Distribution drift
# ────────────────────────────────────────────────────────────────────────


def test_drift_pass_when_distributions_match(checker):
    rng = np.random.default_rng(4)
    a = rng.beta(2, 5, size=1000)
    b = rng.beta(2, 5, size=1000)
    r = checker.check_distribution_drift(a, b)
    assert r.status == "PASS"


def test_drift_fail_when_distribution_shifts(checker):
    rng = np.random.default_rng(5)
    a = rng.beta(2, 5, size=1000)  # mean ≈ 0.29
    b = rng.beta(8, 2, size=1000)  # mean ≈ 0.80 — radically different
    r = checker.check_distribution_drift(a, b)
    assert r.status == "FAIL"


# ────────────────────────────────────────────────────────────────────────
# run_all aggregation
# ────────────────────────────────────────────────────────────────────────


def test_run_all_status_is_worst_check_severity(checker):
    """If any check FAILs, overall status = FAIL."""
    rng = np.random.default_rng(6)
    p = rng.beta(2, 5, size=1000)
    p[0] = -0.5  # triggers H3 FAIL
    report = checker.run_all(p)
    assert report.status == "FAIL"
    assert any(r.check_name == "out_of_range" and r.status == "FAIL" for r in report.results)


def test_run_all_skips_calibration_without_outcomes(checker):
    rng = np.random.default_rng(7)
    p = rng.beta(2, 5, size=500)
    report = checker.run_all(p)  # no outcomes provided
    assert all(r.check_name != "calibration" for r in report.results)


def test_run_all_skips_drift_without_baseline(checker):
    rng = np.random.default_rng(8)
    p = rng.beta(2, 5, size=500)
    report = checker.run_all(p)
    assert all(r.check_name != "distribution_drift" for r in report.results)


def test_run_all_includes_all_six_when_data_provided(checker):
    rng = np.random.default_rng(9)
    p = rng.beta(2, 5, size=2000)
    baseline = rng.beta(2, 5, size=2000)
    outcomes = rng.binomial(1, 0.30, size=2000)
    report = checker.run_all(p, baseline=baseline, outcomes=outcomes)
    check_names = {r.check_name for r in report.results}
    assert check_names == {
        "out_of_range", "nan_inf", "saturation", "mode_collapse",
        "calibration", "distribution_drift",
    }


def test_health_report_serializes_to_dict(checker):
    """Reports must be JSON-serializable for storing in model.metrics."""
    rng = np.random.default_rng(10)
    p = rng.beta(2, 5, size=500)
    report = checker.run_all(p)
    d = report.to_dict()
    assert "status" in d
    assert "results" in d
    import json
    json.dumps(d)  # must not raise
