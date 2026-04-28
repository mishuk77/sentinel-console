"""
InferenceHealthChecker — six health checks shared across all three layers
of the TASK-10 guardrail system.

Spec reference: TASK-9 + TASK-10 (three-layer guardrails)

The same checker class is used at:
    Layer 1 — training time (after model.fit, before artifact write)
    Layer 2 — registration time (when a model is bound to a decision system)
    Layer 3 — runtime (rolling window of recent production predictions)

Each check returns a HealthCheckResult with status (PASS / WARN / FAIL),
the observed value, the thresholds, and a human-readable message. The
spec's strategic framing — "Sentinel automatically checks every model
for saturation, calibration, distribution drift, and pipeline integrity
before it ever serves a decision" — depends on these six checks running
identically across all three layers.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

import numpy as np


HealthStatus = Literal["PASS", "WARN", "FAIL"]


@dataclass
class HealthCheckResult:
    """Single check result. Status is ordered PASS < WARN < FAIL by severity."""

    check_name: str
    status: HealthStatus
    observed_value: float
    threshold_warn: Optional[float]
    threshold_fail: Optional[float]
    message: str

    @property
    def is_blocking(self) -> bool:
        """FAIL blocks deployment / registration / artifact write."""
        return self.status == "FAIL"


@dataclass
class HealthReport:
    """Aggregate of all checks run on a sample. Used to expose a single
    health_status field on a model or decision system."""

    results: list[HealthCheckResult] = field(default_factory=list)

    @property
    def status(self) -> HealthStatus:
        """Worst severity across all checks."""
        if any(r.status == "FAIL" for r in self.results):
            return "FAIL"
        if any(r.status == "WARN" for r in self.results):
            return "WARN"
        return "PASS"

    @property
    def is_healthy(self) -> bool:
        return self.status == "PASS"

    @property
    def failures(self) -> list[HealthCheckResult]:
        return [r for r in self.results if r.status == "FAIL"]

    @property
    def warnings(self) -> list[HealthCheckResult]:
        return [r for r in self.results if r.status == "WARN"]

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "results": [
                {
                    "check_name": r.check_name,
                    "status": r.status,
                    "observed_value": r.observed_value,
                    "threshold_warn": r.threshold_warn,
                    "threshold_fail": r.threshold_fail,
                    "message": r.message,
                }
                for r in self.results
            ],
        }


# Thresholds — pulled from the TASK-10 spec. Pinned as constants so tests
# encode them and any change requires an explicit code edit.
_SATURATION_WARN = 0.60
_SATURATION_FAIL = 0.80
_MODE_COLLAPSE_WARN_STD = 0.05
_MODE_COLLAPSE_FAIL_STD = 0.02
_CALIBRATION_WARN_PP = 0.05  # 5 percentage points
_CALIBRATION_FAIL_PP = 0.15  # 15 percentage points
_DRIFT_WARN_KS = 0.15
_DRIFT_FAIL_KS = 0.25


class InferenceHealthChecker:
    """Stateless checker — one instance per check call is fine. Methods are
    pure functions of the input arrays (no DB, no I/O)."""

    def check_saturation(self, predictions: np.ndarray) -> HealthCheckResult:
        """H1 — % of predictions where p > 0.95 OR p < 0.05.

        Catches the LR bug from TASK-1: if 80%+ of predictions are pegged
        at the extremes, the model is broken regardless of how it scored
        on training metrics."""
        p = np.asarray(predictions, dtype=float)
        n = len(p)
        if n == 0:
            return HealthCheckResult(
                "saturation", "PASS", 0.0, _SATURATION_WARN, _SATURATION_FAIL,
                "no predictions to check",
            )
        sat_frac = float(((p > 0.95) | (p < 0.05)).sum()) / n
        if sat_frac > _SATURATION_FAIL:
            status: HealthStatus = "FAIL"
            msg = (
                f"{sat_frac:.1%} of predictions are saturated (>0.95 or <0.05); "
                f"threshold is {_SATURATION_FAIL:.0%}. The model is likely broken — "
                f"check preprocessing pipeline (TASK-1 root cause)."
            )
        elif sat_frac > _SATURATION_WARN:
            status = "WARN"
            msg = (
                f"{sat_frac:.1%} of predictions are at the extremes — review the "
                f"score distribution before relying on these decisions."
            )
        else:
            status = "PASS"
            msg = f"{sat_frac:.1%} of predictions at extremes (within healthy range)"
        return HealthCheckResult("saturation", status, sat_frac,
                                 _SATURATION_WARN, _SATURATION_FAIL, msg)

    def check_mode_collapse(self, predictions: np.ndarray) -> HealthCheckResult:
        """H2 — std of predictions. Catches models that predict the same
        value for everything (e.g., always predicts the base rate)."""
        p = np.asarray(predictions, dtype=float)
        if len(p) < 2:
            return HealthCheckResult(
                "mode_collapse", "PASS", 0.0,
                _MODE_COLLAPSE_WARN_STD, _MODE_COLLAPSE_FAIL_STD,
                "insufficient predictions to compute std",
            )
        std = float(np.std(p))
        if std < _MODE_COLLAPSE_FAIL_STD:
            status: HealthStatus = "FAIL"
            msg = (
                f"Prediction std is {std:.4f} (threshold < {_MODE_COLLAPSE_FAIL_STD}) — "
                f"model has collapsed to a near-constant predictor."
            )
        elif std < _MODE_COLLAPSE_WARN_STD:
            status = "WARN"
            msg = f"Prediction std is unusually low ({std:.4f}) — verify model is learning"
        else:
            status = "PASS"
            msg = f"Prediction std {std:.4f} (healthy)"
        return HealthCheckResult("mode_collapse", status, std,
                                 _MODE_COLLAPSE_WARN_STD,
                                 _MODE_COLLAPSE_FAIL_STD, msg)

    def check_out_of_range(self, predictions: np.ndarray) -> HealthCheckResult:
        """H3 — count of predictions outside [0, 1]. Catches missing
        sigmoid, sign flip, or other math errors."""
        p = np.asarray(predictions, dtype=float)
        oor = int(((p < 0) | (p > 1)).sum())
        if oor > 0:
            return HealthCheckResult(
                "out_of_range", "FAIL", float(oor), 0.0, 0.0,
                f"{oor} predictions outside [0,1] — math error in inference path",
            )
        return HealthCheckResult(
            "out_of_range", "PASS", 0.0, 0.0, 0.0,
            "All predictions in [0, 1]",
        )

    def check_nan_inf(self, predictions: np.ndarray) -> HealthCheckResult:
        """H4 — count of NaN or Inf predictions. Catches numerical
        instability."""
        p = np.asarray(predictions, dtype=float)
        bad = int((~np.isfinite(p)).sum())
        if bad > 0:
            return HealthCheckResult(
                "nan_inf", "FAIL", float(bad), 0.0, 0.0,
                f"{bad} non-finite predictions (NaN or Inf) — numerical instability",
            )
        return HealthCheckResult(
            "nan_inf", "PASS", 0.0, 0.0, 0.0,
            "All predictions finite",
        )

    def check_calibration(
        self, predictions: np.ndarray, outcomes: np.ndarray
    ) -> HealthCheckResult:
        """H5 — |mean(predicted) - mean(observed)|.

        Required minimum sample size: 2000 rows for stable estimate at low
        base rates. The caller is expected to skip this check (or use
        the next-larger-available sample) when the holdout is smaller."""
        p = np.asarray(predictions, dtype=float)
        y = np.asarray(outcomes, dtype=float)
        if len(p) == 0 or len(y) == 0 or len(p) != len(y):
            return HealthCheckResult(
                "calibration", "PASS", 0.0,
                _CALIBRATION_WARN_PP, _CALIBRATION_FAIL_PP,
                "no outcome data — calibration not checked",
            )
        diff = abs(float(np.mean(p)) - float(np.mean(y)))
        if diff > _CALIBRATION_FAIL_PP:
            status: HealthStatus = "FAIL"
            msg = (
                f"Predicted mean {float(np.mean(p)):.3f} vs observed {float(np.mean(y)):.3f} "
                f"differs by {diff:.3f} (>{_CALIBRATION_FAIL_PP:.2f}). "
                f"Model is wildly miscalibrated."
            )
        elif diff > _CALIBRATION_WARN_PP:
            status = "WARN"
            msg = (
                f"Predicted mean {float(np.mean(p)):.3f} vs observed {float(np.mean(y)):.3f} "
                f"differs by {diff:.3f} — consider recalibrating."
            )
        else:
            status = "PASS"
            msg = f"Calibration error {diff:.3f} (healthy)"
        return HealthCheckResult("calibration", status, diff,
                                 _CALIBRATION_WARN_PP,
                                 _CALIBRATION_FAIL_PP, msg)

    def check_distribution_drift(
        self, predictions: np.ndarray, baseline: np.ndarray
    ) -> HealthCheckResult:
        """H6 — KS statistic between current predictions and the
        registration baseline distribution.

        Per TASK-10 spec: the baseline is FIXED at registration time and
        does NOT shift over time. If population genuinely shifts, the user
        should retrain and re-register, capturing a new baseline."""
        p = np.asarray(predictions, dtype=float)
        b = np.asarray(baseline, dtype=float)
        if len(p) == 0 or len(b) == 0:
            return HealthCheckResult(
                "distribution_drift", "PASS", 0.0,
                _DRIFT_WARN_KS, _DRIFT_FAIL_KS,
                "no baseline distribution to compare",
            )
        ks = _two_sample_ks(p, b)
        if ks > _DRIFT_FAIL_KS:
            status: HealthStatus = "FAIL"
            msg = (
                f"KS statistic {ks:.3f} exceeds drift threshold {_DRIFT_FAIL_KS} — "
                f"prediction distribution has shifted significantly from the "
                f"registration baseline. Likely a feature pipeline regression."
            )
        elif ks > _DRIFT_WARN_KS:
            status = "WARN"
            msg = f"KS statistic {ks:.3f} indicates moderate drift — investigate"
        else:
            status = "PASS"
            msg = f"KS statistic {ks:.3f} (within baseline)"
        return HealthCheckResult("distribution_drift", status, ks,
                                 _DRIFT_WARN_KS, _DRIFT_FAIL_KS, msg)

    # ─────────────────────────────────────────────────────────────────
    # Convenience: run all checks at once
    # ─────────────────────────────────────────────────────────────────

    def run_all(
        self,
        predictions: np.ndarray,
        baseline: Optional[np.ndarray] = None,
        outcomes: Optional[np.ndarray] = None,
    ) -> HealthReport:
        """Run every applicable check on a single prediction sample.

        Skip distribution_drift if no baseline is provided; skip
        calibration if no outcomes are provided. Both situations are
        legitimate — the caller chooses what data is available."""
        results = [
            self.check_out_of_range(predictions),
            self.check_nan_inf(predictions),
            self.check_saturation(predictions),
            self.check_mode_collapse(predictions),
        ]
        if outcomes is not None and len(outcomes) > 0:
            results.append(self.check_calibration(predictions, outcomes))
        if baseline is not None and len(baseline) > 0:
            results.append(self.check_distribution_drift(predictions, baseline))
        return HealthReport(results=results)


# ─────────────────────────────────────────────────────────────────────
# Internals
# ─────────────────────────────────────────────────────────────────────


def _two_sample_ks(a: np.ndarray, b: np.ndarray) -> float:
    """Two-sample Kolmogorov-Smirnov statistic. Implemented inline rather
    than via scipy.stats.ks_2samp so we don't pull scipy in at runtime
    just for the health checks."""
    a_sorted = np.sort(a)
    b_sorted = np.sort(b)
    all_values = np.unique(np.concatenate([a_sorted, b_sorted]))
    cdf_a = np.searchsorted(a_sorted, all_values, side="right") / len(a_sorted)
    cdf_b = np.searchsorted(b_sorted, all_values, side="right") / len(b_sorted)
    return float(np.max(np.abs(cdf_a - cdf_b)))
