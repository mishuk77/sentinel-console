"""
portfolio_simulation — the deterministic, full-precision simulation engine.

Spec reference:
    TASK-3  (exposure control full impact table)
    TASK-7  (projected simulation summary)
    TASK-11B (reconciliation rules)

Why this exists
---------------
Every CFO-grade comparison table on the platform — exposure control,
projected simulation, segmentation portfolio totals — is computed by this
engine. There is one engine, one set of formulas, and one source of truth
for predicted loss math. If a number doesn't reconcile across pages, the
bug is here.

Three stages, evaluated on the same population
----------------------------------------------

    Stage 1 — BASELINE
        Approve everyone at the requested amount. Loss = approved_amount ×
        predicted_probability summed over all rows. This is the upper bound
        — what the population would do without any policy.

    Stage 2 — POLICY CUTS
        Score < cutoff → approve at full requested amount. Score >= cutoff
        → deny. Loss is summed over the approved subset only.

    Stage 3 — POLICY CUTS + LADDER
        Same approval set as Stage 2, but approved amounts are capped by
        the loan-amount ladder. Loss uses the ladder-adjusted amount.

Critical math invariants (all enforced by reconciliation tests):

    avg_approved_$ × approval_count = total_approved_$
        within rounding tolerance (we compute totals from raw values, not
        from rounded displays — TASK-11B)

    sum(approved_count_in_each_stage) does NOT exceed total_applications
        applications can be denied but never duplicated

    stage_2.approval_count == stage_3.approval_count
        the ladder doesn't change who is approved, only how much they get

    stage_3.total_approved_$ <= stage_2.total_approved_$
        ladder caps can only reduce approved amounts, not increase them

    predicted_loss_$ <= approved_$ for any stage
        predicted probability is always in [0, 1]

Predicted loss formulas (no LGD field — assume 100%, per Q1 resolution):

    predicted_loss_$_per_row = approved_amount × predicted_probability
    predicted_loss_count = sum of predicted_probabilities over approved rows
        (this is the expected number of defaults — a continuous quantity that
        rounds to an integer for display only)
    predicted_loss_rate_count = predicted_loss_count / approval_count
    predicted_loss_rate_dollars = predicted_loss_$ / approved_$

The engine never uses observed (historical) loss data when computing the
three stages. Observed data is shown separately on TASK-7's baseline panel
for context, never mixed into the comparison.
"""

from __future__ import annotations

from dataclasses import dataclass, field, asdict
from typing import Optional

import numpy as np
import pandas as pd


# ────────────────────────────────────────────────────────────────────────
# Inputs
# ────────────────────────────────────────────────────────────────────────

@dataclass
class PolicyConfig:
    """The policy parameters that drive a simulation. Every field is the
    user's explicit configuration, not derived state."""

    # Score cutoff for approval. Applications with predicted_probability
    # strictly less than this are approved; >= is denied.
    cutoff: float

    # Loan amount ladder mapping risk decile (1 = lowest risk) → max
    # approved amount in dollars. Optional — when None or empty, the ladder
    # stage is skipped (Stage 3 == Stage 2).
    amount_ladder: Optional[dict[int, float]] = None

    # Number of deciles the ladder is keyed by. Most platforms use 10.
    n_deciles: int = 10


@dataclass
class SimulationInputs:
    """Per-row inputs for the simulation. Constructed from the dataset +
    model scores. Lengths must match."""

    scores: np.ndarray  # predicted probability of bad event, shape (n,)
    requested_amounts: Optional[np.ndarray] = None  # shape (n,) or None when no amount column
    application_ids: Optional[list] = None  # shape (n,) — for "what changed" diff (TASK-11G)


# ────────────────────────────────────────────────────────────────────────
# Outputs
# ────────────────────────────────────────────────────────────────────────

@dataclass
class StageMetrics:
    """All 10 metrics for one simulation stage. Computed at full precision;
    rounding is the UI's job (TASK-11B)."""

    stage_name: str  # "baseline" | "policy_cuts" | "policy_cuts_ladder"

    # Counts
    total_applications: int
    approval_count: int
    approval_rate: float  # approval_count / total_applications

    # Dollar metrics (None when Mode 3 — no approved amount column)
    total_approved_dollars: Optional[float]
    avg_approved_dollars: Optional[float]

    # Predicted loss
    predicted_loss_count: float  # expected count of defaults — sum of probs
    predicted_loss_rate_count: float  # predicted_loss_count / approval_count
    total_predicted_loss_dollars: Optional[float]
    predicted_loss_rate_dollars: Optional[float]  # total_loss_$ / total_approved_$
    net_risk_adjusted_dollars: Optional[float]  # total_approved_$ - total_loss_$

    # Bookkeeping for reconciliation tests
    raw_total_approved_dollars: Optional[float] = None  # full precision, no rounding
    raw_total_predicted_loss_dollars: Optional[float] = None

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class StageDelta:
    """Stage-to-stage delta. All fields are optional because some don't
    apply when dollar metrics are unavailable (Mode 3)."""

    metric_name: str
    baseline_value: Optional[float]
    final_value: Optional[float]
    delta_absolute: Optional[float]
    delta_relative: Optional[float]  # as a fraction (0.05 = 5%)


@dataclass
class SimulationResult:
    """Full simulation output: each stage + the variance vs. baseline."""

    baseline: StageMetrics
    policy_cuts: StageMetrics
    policy_cuts_ladder: StageMetrics
    deltas_vs_baseline: list[StageDelta] = field(default_factory=list)

    # Audit metadata (TASK-11C)
    n_rows_total: int = 0
    n_rows_unscoreable: int = 0  # excluded from approval counts
    has_dollar_metrics: bool = False

    def to_dict(self) -> dict:
        return {
            "baseline": self.baseline.to_dict(),
            "policy_cuts": self.policy_cuts.to_dict(),
            "policy_cuts_ladder": self.policy_cuts_ladder.to_dict(),
            "deltas_vs_baseline": [asdict(d) for d in self.deltas_vs_baseline],
            "n_rows_total": self.n_rows_total,
            "n_rows_unscoreable": self.n_rows_unscoreable,
            "has_dollar_metrics": self.has_dollar_metrics,
        }


# ────────────────────────────────────────────────────────────────────────
# Engine
# ────────────────────────────────────────────────────────────────────────


def simulate_portfolio(
    inputs: SimulationInputs,
    policy: PolicyConfig,
) -> SimulationResult:
    """
    Compute all three stages and return the full SimulationResult.

    Math invariants (also enforced by tests):
      * Stage 2 and Stage 3 have identical approval_count.
      * Stage 3 total_approved_dollars <= Stage 2 total_approved_dollars.
      * predicted_loss_dollars <= approved_dollars in any stage.
      * sum-of-predicted-loss across deciles = total predicted loss
        (no row is double-counted).
    """
    scores = np.asarray(inputs.scores, dtype=float)
    n = len(scores)
    if n == 0:
        raise ValueError("simulate_portfolio called with zero rows")

    has_amounts = inputs.requested_amounts is not None
    if has_amounts:
        requested = np.asarray(inputs.requested_amounts, dtype=float)
        if len(requested) != n:
            raise ValueError(
                f"requested_amounts length ({len(requested)}) does not match "
                f"scores length ({n})"
            )
    else:
        requested = None

    # Stage 1 — Baseline (approve everyone at requested amount)
    baseline = _compute_stage(
        stage_name="baseline",
        approved_mask=np.ones(n, dtype=bool),
        approved_amounts=requested if has_amounts else None,
        scores=scores,
        n_total=n,
    )

    # Stage 2 — Policy cuts only
    cut_mask = scores < policy.cutoff
    cuts = _compute_stage(
        stage_name="policy_cuts",
        approved_mask=cut_mask,
        approved_amounts=requested if has_amounts else None,
        scores=scores,
        n_total=n,
    )

    # Stage 3 — Policy cuts + ladder
    if policy.amount_ladder and has_amounts:
        ladder_amounts = _apply_ladder(
            requested,
            scores,
            cut_mask,
            policy.amount_ladder,
            policy.n_deciles,
        )
    else:
        # No ladder: stage 3 == stage 2
        ladder_amounts = requested if has_amounts else None

    cuts_ladder = _compute_stage(
        stage_name="policy_cuts_ladder",
        approved_mask=cut_mask,
        approved_amounts=ladder_amounts,
        scores=scores,
        n_total=n,
    )

    # Compute deltas vs baseline (TASK-3 spec: Δ vs Baseline column)
    deltas = _compute_deltas(baseline, cuts_ladder)

    return SimulationResult(
        baseline=baseline,
        policy_cuts=cuts,
        policy_cuts_ladder=cuts_ladder,
        deltas_vs_baseline=deltas,
        n_rows_total=n,
        n_rows_unscoreable=0,  # caller is responsible for filtering these out
        has_dollar_metrics=has_amounts,
    )


# ────────────────────────────────────────────────────────────────────────
# Internals
# ────────────────────────────────────────────────────────────────────────


def _compute_stage(
    stage_name: str,
    approved_mask: np.ndarray,
    approved_amounts: Optional[np.ndarray],
    scores: np.ndarray,
    n_total: int,
) -> StageMetrics:
    """Compute every metric for a single stage at full precision.

    approved_mask : boolean array, True for approved rows.
    approved_amounts : optional dollars per row (full precision). When None,
        only count metrics are produced; dollar metrics return None.
    scores : predicted probabilities for ALL rows (so the loss-count math
        uses the right rows after masking).
    n_total : total population size (used for approval_rate denominator).
    """
    approval_count = int(approved_mask.sum())
    approval_rate = approval_count / n_total if n_total > 0 else 0.0

    # Predicted defaulters = expected count = sum of probs over approved rows.
    # This is a continuous number; UI rounds for display.
    if approval_count > 0:
        approved_scores = scores[approved_mask]
        predicted_loss_count = float(approved_scores.sum())
        predicted_loss_rate_count = predicted_loss_count / approval_count
    else:
        predicted_loss_count = 0.0
        predicted_loss_rate_count = 0.0

    # Dollar metrics — only computable when amounts are available
    if approved_amounts is not None and approval_count > 0:
        approved_amts = approved_amounts[approved_mask]
        approved_score_subset = scores[approved_mask]
        total_approved = float(approved_amts.sum())
        avg_approved = total_approved / approval_count
        # Loss = approved_amount × probability, summed over approved rows
        loss_per_row = approved_amts * approved_score_subset
        total_loss = float(loss_per_row.sum())
        loss_rate_dollars = total_loss / total_approved if total_approved > 0 else 0.0
        net_risk_adjusted = total_approved - total_loss
    elif approved_amounts is not None:
        # No approvals — dollars are zero, not None
        total_approved = 0.0
        avg_approved = 0.0
        total_loss = 0.0
        loss_rate_dollars = 0.0
        net_risk_adjusted = 0.0
    else:
        # Mode 3 — no approved amounts known
        total_approved = None
        avg_approved = None
        total_loss = None
        loss_rate_dollars = None
        net_risk_adjusted = None

    return StageMetrics(
        stage_name=stage_name,
        total_applications=n_total,
        approval_count=approval_count,
        approval_rate=approval_rate,
        total_approved_dollars=total_approved,
        avg_approved_dollars=avg_approved,
        predicted_loss_count=predicted_loss_count,
        predicted_loss_rate_count=predicted_loss_rate_count,
        total_predicted_loss_dollars=total_loss,
        predicted_loss_rate_dollars=loss_rate_dollars,
        net_risk_adjusted_dollars=net_risk_adjusted,
        raw_total_approved_dollars=total_approved,
        raw_total_predicted_loss_dollars=total_loss,
    )


def _apply_ladder(
    requested_amounts: np.ndarray,
    scores: np.ndarray,
    approved_mask: np.ndarray,
    ladder: dict[int, float],
    n_deciles: int,
) -> np.ndarray:
    """
    Apply the loan-amount ladder by decile. Returns a per-row amount array
    where approved rows are capped by the ladder and denied rows are zeroed.

    Decile assignment uses score quantiles over the entire population (not
    just approved rows) so the decile boundaries are stable as the cutoff
    moves. Decile 1 = LOWEST risk (lowest scores); Decile n_deciles =
    HIGHEST risk.

    Note: in the existing loan_amount_service the ladder is keyed by
    integer string ("1", "2", ...) when persisted in JSON. We accept both
    int and string keys here to be defensive.
    """
    n = len(scores)
    out = requested_amounts.copy()

    # Compute decile assignment for every row using quantiles. Use a stable
    # rank-based approach to avoid edge cases when many scores tie.
    if n >= n_deciles:
        ranks = pd.Series(scores).rank(method="min")  # 1..n
        # Map to decile 1..n_deciles
        deciles = ((ranks - 1) * n_deciles / n).astype(int) + 1
        deciles = deciles.clip(upper=n_deciles).values
    else:
        # Tiny populations — assign all to decile 1
        deciles = np.ones(n, dtype=int)

    # Cap each approved row's amount by its decile ladder entry
    for i in range(n):
        if not approved_mask[i]:
            out[i] = 0.0
            continue
        d = int(deciles[i])
        cap = _ladder_lookup(ladder, d)
        if cap is not None:
            out[i] = min(out[i], cap)
        # If ladder has no entry for this decile, leave amount unchanged

    return out


def _ladder_lookup(ladder: dict, decile: int) -> Optional[float]:
    """Look up a ladder entry. Accepts int or string keys."""
    if decile in ladder:
        return float(ladder[decile])
    str_key = str(decile)
    if str_key in ladder:
        return float(ladder[str_key])
    return None


def _compute_deltas(
    baseline: StageMetrics, final: StageMetrics
) -> list[StageDelta]:
    """Build the Δ-vs-baseline column entries for a comparison table."""

    deltas: list[StageDelta] = []

    def _add(name: str, b: Optional[float], f: Optional[float]):
        if b is None or f is None:
            deltas.append(StageDelta(name, b, f, None, None))
            return
        delta = f - b
        rel = (delta / b) if b != 0 else None
        deltas.append(StageDelta(name, b, f, delta, rel))

    _add("approval_count", baseline.approval_count, final.approval_count)
    _add("approval_rate", baseline.approval_rate, final.approval_rate)
    _add("total_approved_dollars",
         baseline.total_approved_dollars, final.total_approved_dollars)
    _add("avg_approved_dollars",
         baseline.avg_approved_dollars, final.avg_approved_dollars)
    _add("predicted_loss_count",
         baseline.predicted_loss_count, final.predicted_loss_count)
    _add("predicted_loss_rate_count",
         baseline.predicted_loss_rate_count, final.predicted_loss_rate_count)
    _add("total_predicted_loss_dollars",
         baseline.total_predicted_loss_dollars,
         final.total_predicted_loss_dollars)
    _add("predicted_loss_rate_dollars",
         baseline.predicted_loss_rate_dollars,
         final.predicted_loss_rate_dollars)
    _add("net_risk_adjusted_dollars",
         baseline.net_risk_adjusted_dollars,
         final.net_risk_adjusted_dollars)
    return deltas
