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
from typing import Optional, Literal

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


@dataclass
class SegmentBreakout:
    """TASK-11F: per-segment portfolio metrics for a single stage.

    The same StageMetrics structure as the aggregate, plus segment
    metadata (name and applicant count). Reconciliation rule: the sum
    of per-segment metrics MUST equal the portfolio total (this is
    enforced as a test in test_segment_breakout.py)."""

    segment_label: str
    segment_value: object
    n_applications: int
    metrics: StageMetrics

    def to_dict(self) -> dict:
        return {
            "segment_label": self.segment_label,
            "segment_value": str(self.segment_value),
            "n_applications": self.n_applications,
            "metrics": self.metrics.to_dict(),
        }


def break_out_by_dimension(
    inputs: SimulationInputs,
    policy: PolicyConfig,
    dimension_values: list,
    dimension_label: str,
    stage: Literal["baseline", "policy_cuts", "policy_cuts_ladder"] = "policy_cuts_ladder",
) -> list[SegmentBreakout]:
    """
    Apply ``policy`` to the population and break out results by ``dimension_values``.

    Parameters
    ----------
    inputs : SimulationInputs
        Same population inputs used by simulate_portfolio.
    policy : PolicyConfig
        The policy configuration to apply.
    dimension_values : list
        Per-row values of the breakout dimension. Length must equal the
        number of rows in inputs.scores.
    dimension_label : str
        Human-readable label for the dimension (e.g. 'channel').
    stage : str
        Which stage to compute the per-segment metrics for. Default is
        'policy_cuts_ladder' — the production-equivalent stage.

    Returns
    -------
    list[SegmentBreakout]
        One per unique dimension value, sorted by segment value.

    Reconciliation invariant (per TASK-11B + TASK-11F):
        sum(per_segment_metrics) == portfolio_metrics  (within rounding)
    The sum of segment counts MUST equal total_applications. The sum of
    segment dollar metrics MUST equal the portfolio dollar metrics.
    Tested in test_segment_breakout.py.
    """
    scores = np.asarray(inputs.scores, dtype=float)
    n = len(scores)
    if len(dimension_values) != n:
        raise ValueError(
            f"dimension_values length ({len(dimension_values)}) must match "
            f"scores length ({n})"
        )

    has_amounts = inputs.requested_amounts is not None
    requested = np.asarray(inputs.requested_amounts, dtype=float) if has_amounts else None

    # Compute the policy mask + amounts once for the whole population
    if stage == "baseline":
        approved_mask = np.ones(n, dtype=bool)
        amounts = requested
    elif stage == "policy_cuts":
        approved_mask = scores < policy.cutoff
        amounts = requested if has_amounts else None
    else:  # policy_cuts_ladder
        approved_mask = scores < policy.cutoff
        if policy.amount_ladder and has_amounts:
            amounts = _apply_ladder(
                requested, scores, approved_mask,
                policy.amount_ladder, policy.n_deciles,
            )
        else:
            amounts = requested if has_amounts else None

    # Group by dimension value (preserve order via dict)
    dim_array = np.asarray(dimension_values, dtype=object)
    unique_vals = sorted({str(v) for v in dim_array.tolist()})

    results: list[SegmentBreakout] = []
    for val in unique_vals:
        seg_mask = (dim_array.astype(str) == val)
        seg_n = int(seg_mask.sum())
        if seg_n == 0:
            continue
        # Restrict scores/amounts/approved_mask to this segment
        seg_scores = scores[seg_mask]
        seg_approved = approved_mask[seg_mask]
        seg_amounts = amounts[seg_mask] if amounts is not None else None
        metrics = _compute_stage(
            stage_name=f"{stage}_{val}",
            approved_mask=seg_approved,
            approved_amounts=seg_amounts,
            scores=seg_scores,
            n_total=seg_n,
        )
        results.append(SegmentBreakout(
            segment_label=dimension_label,
            segment_value=val,
            n_applications=seg_n,
            metrics=metrics,
        ))

    return results


@dataclass
class PolicyDiff:
    """TASK-11G + TASK-11H: row-level diff between two policy configs.

    Returns the set of applicants that cross a decision boundary when
    moving from policy A → policy B, with counts, dollar volume, and
    (when available) the list of application IDs.
    """

    # Applicants newly approved by B that were denied by A
    newly_approved_count: int
    newly_approved_dollars: Optional[float]
    newly_approved_ids: list

    # Applicants newly denied by B that were approved by A
    newly_denied_count: int
    newly_denied_dollars: Optional[float]  # under A, since they're not approved by B
    newly_denied_ids: list

    # Applicants approved by both but with reduced amount under B
    reduced_amount_count: int
    reduced_amount_total_reduction: Optional[float]
    reduced_amount_ids: list

    # Aggregate metrics from each policy for context
    policy_a: StageMetrics
    policy_b: StageMetrics

    def to_dict(self) -> dict:
        return {
            "newly_approved_count": self.newly_approved_count,
            "newly_approved_dollars": self.newly_approved_dollars,
            "newly_approved_ids": self.newly_approved_ids,
            "newly_denied_count": self.newly_denied_count,
            "newly_denied_dollars": self.newly_denied_dollars,
            "newly_denied_ids": self.newly_denied_ids,
            "reduced_amount_count": self.reduced_amount_count,
            "reduced_amount_total_reduction": self.reduced_amount_total_reduction,
            "reduced_amount_ids": self.reduced_amount_ids,
            "policy_a": self.policy_a.to_dict(),
            "policy_b": self.policy_b.to_dict(),
        }


def diff_policies(
    inputs: SimulationInputs,
    policy_a: PolicyConfig,
    policy_b: PolicyConfig,
    max_ids_per_bucket: int = 100,
) -> PolicyDiff:
    """
    Compute the row-level diff between two policy configurations applied
    to the same population.

    Used by:
        TASK-11G — "What changed" diff panel on Exposure Control + Policy
        TASK-11H — Compare against prior published policy on simulation pages

    The applicant ID lists are capped at max_ids_per_bucket to keep the
    response payload sane on large datasets; counts and dollar totals are
    always exact.
    """
    scores = np.asarray(inputs.scores, dtype=float)
    n = len(scores)
    if n == 0:
        raise ValueError("diff_policies called with zero rows")

    has_amounts = inputs.requested_amounts is not None
    requested = np.asarray(inputs.requested_amounts, dtype=float) if has_amounts else None
    app_ids = inputs.application_ids if inputs.application_ids is not None else [
        f"row_{i}" for i in range(n)
    ]

    # Compute per-row decisions and amounts under each policy
    cut_a = scores < policy_a.cutoff
    cut_b = scores < policy_b.cutoff

    if has_amounts:
        amts_a = (
            _apply_ladder(requested, scores, cut_a, policy_a.amount_ladder, policy_a.n_deciles)
            if policy_a.amount_ladder
            else np.where(cut_a, requested, 0.0)
        )
        amts_b = (
            _apply_ladder(requested, scores, cut_b, policy_b.amount_ladder, policy_b.n_deciles)
            if policy_b.amount_ladder
            else np.where(cut_b, requested, 0.0)
        )
    else:
        amts_a = amts_b = None

    # Bucket categorization
    newly_approved = (~cut_a) & cut_b
    newly_denied = cut_a & (~cut_b)
    both_approved = cut_a & cut_b
    reduced = both_approved & (
        (amts_b < amts_a) if amts_a is not None and amts_b is not None
        else np.zeros(n, dtype=bool)
    )

    def _ids(mask):
        idxs = np.where(mask)[0]
        return [str(app_ids[i]) for i in idxs[:max_ids_per_bucket]]

    newly_approved_dollars = (
        float(amts_b[newly_approved].sum()) if amts_b is not None else None
    )
    newly_denied_dollars = (
        float(amts_a[newly_denied].sum()) if amts_a is not None else None
    )
    if amts_a is not None and amts_b is not None:
        reduction_total = float((amts_a[reduced] - amts_b[reduced]).sum())
    else:
        reduction_total = None

    # Compute aggregate stage metrics for both policies for the side panel
    def _stage_for(mask, amts, name):
        return _compute_stage(
            stage_name=name,
            approved_mask=mask,
            approved_amounts=amts,
            scores=scores,
            n_total=n,
        )

    return PolicyDiff(
        newly_approved_count=int(newly_approved.sum()),
        newly_approved_dollars=newly_approved_dollars,
        newly_approved_ids=_ids(newly_approved),
        newly_denied_count=int(newly_denied.sum()),
        newly_denied_dollars=newly_denied_dollars,
        newly_denied_ids=_ids(newly_denied),
        reduced_amount_count=int(reduced.sum()),
        reduced_amount_total_reduction=reduction_total,
        reduced_amount_ids=_ids(reduced),
        policy_a=_stage_for(cut_a, amts_a, "policy_a"),
        policy_b=_stage_for(cut_b, amts_b, "policy_b"),
    )


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
