"""
Reconciliation test suite for the portfolio simulation engine.

Spec reference:
    TASK-3   (exposure control table — 3 stages × 10 metrics)
    TASK-11B (reconciliation rules: avg × count = total, segment sum = portfolio,
              baseline + delta = final)

Every reconciliation rule from the spec is encoded as a test here. If any
of these tests fail, the math is wrong somewhere and CFO-grade reporting
is broken — these tests block deployment per TASK-11B acceptance criteria.

Test categories:
    1. Math invariants per stage
    2. Cross-stage invariants (Stage 2 vs Stage 3, etc.)
    3. Reconciliation rules (avg × count = total)
    4. Edge cases (no approvals, no amounts, ladder absent)
    5. Determinism (same inputs → same outputs)
"""

from __future__ import annotations

import numpy as np
import pytest

from app.services.portfolio_simulation import (
    PolicyConfig,
    SimulationInputs,
    simulate_portfolio,
)


# ────────────────────────────────────────────────────────────────────────
# Helper: construct a deterministic small population we can reason about
# ────────────────────────────────────────────────────────────────────────


def _small_population():
    """10 applications. Scores span 0..1; amounts range $1k-$10k.

    Indexed by sort order (lowest score first, highest score last):

        i=0: score=0.05, amount=$10000
        i=1: score=0.15, amount=$ 9000
        i=2: score=0.25, amount=$ 8000
        i=3: score=0.35, amount=$ 7000
        i=4: score=0.45, amount=$ 6000
        i=5: score=0.55, amount=$ 5000
        i=6: score=0.65, amount=$ 4000
        i=7: score=0.75, amount=$ 3000
        i=8: score=0.85, amount=$ 2000
        i=9: score=0.95, amount=$ 1000

    Total approved at baseline (everyone): $55,000.
    Predicted loss at baseline: sum(amount * score) for i in 0..9.
    """
    scores = np.array([
        0.05, 0.15, 0.25, 0.35, 0.45,
        0.55, 0.65, 0.75, 0.85, 0.95,
    ])
    amounts = np.array([
        10_000, 9_000, 8_000, 7_000, 6_000,
        5_000, 4_000, 3_000, 2_000, 1_000,
    ], dtype=float)
    return SimulationInputs(scores=scores, requested_amounts=amounts)


# ────────────────────────────────────────────────────────────────────────
# Math invariants per stage
# ────────────────────────────────────────────────────────────────────────


def test_baseline_approves_everyone():
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=1.0))  # cutoff=1 → everyone passes
    assert res.baseline.approval_count == 10
    assert res.baseline.approval_rate == pytest.approx(1.0)


def test_baseline_total_approved_dollars_matches_sum():
    """Baseline total_approved_$ must equal the sum of requested amounts."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    expected = inp.requested_amounts.sum()
    assert res.baseline.total_approved_dollars == pytest.approx(expected)


def test_baseline_predicted_loss_count_equals_sum_of_scores():
    """Predicted loss count is the expected number of defaults — i.e. sum of
    probabilities over approved rows. At baseline, that's the full sum."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    expected = inp.scores.sum()
    assert res.baseline.predicted_loss_count == pytest.approx(expected)


def test_baseline_predicted_loss_dollars_equals_sum_of_amount_times_score():
    """predicted_loss_$ at baseline = Σ(amount × probability) over all rows."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    expected = float((inp.scores * inp.requested_amounts).sum())
    assert res.baseline.total_predicted_loss_dollars == pytest.approx(expected)


def test_policy_cuts_rejects_at_or_above_cutoff():
    """Cutoff = 0.5 means scores < 0.5 are approved (i=0..4 in our pop)."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    # Scores 0.05, 0.15, 0.25, 0.35, 0.45 are below 0.5 → 5 approved
    assert res.policy_cuts.approval_count == 5
    assert res.policy_cuts.approval_rate == pytest.approx(0.5)


def test_policy_cuts_total_dollars_excludes_denied():
    """Approved $ in stage 2 = sum of amounts on approved rows only."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    expected = float(inp.requested_amounts[:5].sum())  # rows 0..4
    assert res.policy_cuts.total_approved_dollars == pytest.approx(expected)


# ────────────────────────────────────────────────────────────────────────
# Cross-stage invariants
# ────────────────────────────────────────────────────────────────────────


def test_stage_2_and_stage_3_have_same_approval_count():
    """The ladder doesn't change WHO is approved, only HOW MUCH each gets."""
    inp = _small_population()
    policy = PolicyConfig(
        cutoff=0.7,
        amount_ladder={1: 9_000, 2: 8_000, 3: 7_000, 4: 6_000, 5: 5_000,
                       6: 4_000, 7: 3_000, 8: 2_000, 9: 1_000, 10: 500},
    )
    res = simulate_portfolio(inp, policy)
    assert res.policy_cuts.approval_count == res.policy_cuts_ladder.approval_count


def test_stage_3_approved_dollars_le_stage_2():
    """Ladder caps can only reduce amounts, never raise them."""
    inp = _small_population()
    policy = PolicyConfig(
        cutoff=0.5,
        amount_ladder={1: 5_000, 2: 4_000, 3: 3_000, 4: 2_000, 5: 1_000,
                       6: 500, 7: 300, 8: 200, 9: 100, 10: 50},
    )
    res = simulate_portfolio(inp, policy)
    assert res.policy_cuts_ladder.total_approved_dollars <= res.policy_cuts.total_approved_dollars


def test_predicted_loss_dollars_le_approved_dollars_every_stage():
    """Since probability is in [0,1], predicted loss ≤ approved $."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        if stage.total_predicted_loss_dollars is not None:
            assert stage.total_predicted_loss_dollars <= stage.total_approved_dollars + 1e-9


def test_net_risk_adjusted_equals_approved_minus_loss():
    """Per spec: Net Risk-Adjusted $ = Total Approved $ − Total Predicted Loss $."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        expected = stage.total_approved_dollars - stage.total_predicted_loss_dollars
        assert stage.net_risk_adjusted_dollars == pytest.approx(expected)


# ────────────────────────────────────────────────────────────────────────
# Reconciliation rules (TASK-11B)
# ────────────────────────────────────────────────────────────────────────


def test_avg_times_count_equals_total_within_rounding():
    """For every stage with approvals, avg_approved_$ × approval_count must
    equal total_approved_$ within rounding tolerance.

    This is the cardinal rule from TASK-11B: 'compute totals from raw values,
    not from rounded displays'. Because our engine computes total directly
    and avg as total/count, the equality holds exactly.
    """
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.7))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        if stage.approval_count > 0:
            reconstructed = stage.avg_approved_dollars * stage.approval_count
            assert reconstructed == pytest.approx(stage.total_approved_dollars, rel=1e-9)


def test_loss_rate_count_equals_loss_count_div_approval_count():
    """predicted_loss_rate_count = predicted_loss_count / approval_count.

    No double-rounding allowed."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        if stage.approval_count > 0:
            expected = stage.predicted_loss_count / stage.approval_count
            assert stage.predicted_loss_rate_count == pytest.approx(expected, rel=1e-9)


def test_loss_rate_dollars_equals_loss_dollars_div_approved_dollars():
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        if stage.total_approved_dollars and stage.total_approved_dollars > 0:
            expected = (stage.total_predicted_loss_dollars
                        / stage.total_approved_dollars)
            assert stage.predicted_loss_rate_dollars == pytest.approx(expected, rel=1e-9)


def test_baseline_plus_delta_equals_final():
    """For every metric in the deltas list: baseline + delta = final.

    This is the 'baseline + Δ = simulated outcome' rule from the TASK-11B
    self-review checklist."""
    inp = _small_population()
    res = simulate_portfolio(
        inp,
        PolicyConfig(
            cutoff=0.5,
            amount_ladder={1: 5_000, 2: 4_000, 3: 3_000, 4: 2_000, 5: 1_000,
                           6: 500, 7: 400, 8: 300, 9: 200, 10: 100},
        ),
    )
    for delta in res.deltas_vs_baseline:
        if delta.baseline_value is None or delta.final_value is None:
            continue
        reconstructed = delta.baseline_value + delta.delta_absolute
        assert reconstructed == pytest.approx(delta.final_value, abs=1e-6)


# ────────────────────────────────────────────────────────────────────────
# Edge cases
# ────────────────────────────────────────────────────────────────────────


def test_no_approvals_when_cutoff_zero():
    """Cutoff = 0 means nothing is approved (no score is < 0)."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.0))
    assert res.policy_cuts.approval_count == 0
    assert res.policy_cuts.approval_rate == pytest.approx(0.0)
    assert res.policy_cuts.total_approved_dollars == pytest.approx(0.0)
    assert res.policy_cuts.predicted_loss_count == pytest.approx(0.0)
    assert res.policy_cuts.total_predicted_loss_dollars == pytest.approx(0.0)


def test_dollar_metrics_are_none_in_mode_3():
    """Mode 3 — no requested_amounts available → dollar metrics are None,
    counts still work."""
    scores = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
    inp = SimulationInputs(scores=scores, requested_amounts=None)
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5))
    for stage in (res.baseline, res.policy_cuts, res.policy_cuts_ladder):
        assert stage.total_approved_dollars is None
        assert stage.avg_approved_dollars is None
        assert stage.total_predicted_loss_dollars is None
        # Count metrics still populated
        assert isinstance(stage.approval_count, int)
        assert isinstance(stage.predicted_loss_count, float)
    assert res.has_dollar_metrics is False


def test_ladder_absent_means_stage_3_equals_stage_2():
    """When no ladder is configured, Stage 3 must produce identical metrics
    to Stage 2 (per TASK-3 spec note: 'count metrics are identical')."""
    inp = _small_population()
    res = simulate_portfolio(inp, PolicyConfig(cutoff=0.5, amount_ladder=None))
    s2, s3 = res.policy_cuts, res.policy_cuts_ladder
    assert s3.approval_count == s2.approval_count
    assert s3.total_approved_dollars == pytest.approx(s2.total_approved_dollars)
    assert s3.total_predicted_loss_dollars == pytest.approx(s2.total_predicted_loss_dollars)


def test_ladder_caps_amounts_to_decile_limit():
    """When the ladder caps a row's amount below its requested value, the
    stage 3 amount must reflect the cap.

    With 10 deciles and 10 rows of strictly-increasing scores, each row
    gets its own decile. Row i (0-indexed) is in decile i+1.
    """
    inp = _small_population()
    # Ladder: cap every decile at $500. Approved rows should all receive $500.
    flat_ladder = {d: 500.0 for d in range(1, 11)}
    res = simulate_portfolio(
        inp,
        PolicyConfig(cutoff=1.0, amount_ladder=flat_ladder),
    )
    # Everyone is approved (cutoff=1.0). Everyone is capped at $500.
    assert res.policy_cuts_ladder.total_approved_dollars == pytest.approx(10 * 500)
    assert res.policy_cuts_ladder.avg_approved_dollars == pytest.approx(500)


def test_ladder_does_not_raise_amounts():
    """If ladder cap > requested amount, the row keeps its (lower) requested amount."""
    inp = _small_population()
    # Ladder cap of $1M is way above any requested amount.
    high_ladder = {d: 1_000_000 for d in range(1, 11)}
    res = simulate_portfolio(
        inp,
        PolicyConfig(cutoff=1.0, amount_ladder=high_ladder),
    )
    # Stage 3 should equal stage 2 (no row was capped down).
    assert res.policy_cuts_ladder.total_approved_dollars == pytest.approx(
        res.policy_cuts.total_approved_dollars
    )


# ────────────────────────────────────────────────────────────────────────
# Determinism
# ────────────────────────────────────────────────────────────────────────


def test_simulation_is_deterministic():
    """Same inputs → byte-identical outputs. Required for TASK-11D
    reproducibility guarantee and TASK-8 backtest determinism."""
    inp = _small_population()
    policy = PolicyConfig(
        cutoff=0.5,
        amount_ladder={1: 7_000, 2: 6_000, 3: 5_000, 4: 4_000, 5: 3_000,
                       6: 2_000, 7: 1_500, 8: 1_000, 9: 500, 10: 200},
    )
    r1 = simulate_portfolio(inp, policy).to_dict()
    r2 = simulate_portfolio(inp, policy).to_dict()
    assert r1 == r2


# ────────────────────────────────────────────────────────────────────────
# Realistic mid-size population — sanity on bigger numbers
# ────────────────────────────────────────────────────────────────────────


def test_thousand_row_simulation_metrics_within_expected_ranges():
    """Sanity check: a 1000-row population with realistic distributions
    produces numbers in the expected ballpark."""
    rng = np.random.default_rng(42)
    n = 1000
    # Skewed score distribution: most low risk, long tail of high risk
    scores = np.clip(rng.beta(2, 8, size=n), 0.001, 0.999)
    amounts = rng.lognormal(mean=8.5, sigma=0.5, size=n).round()

    inp = SimulationInputs(scores=scores, requested_amounts=amounts)
    res = simulate_portfolio(
        inp,
        PolicyConfig(
            cutoff=0.3,
            amount_ladder={d: 10_000 - d * 800 for d in range(1, 11)},
        ),
    )

    # Sanity: somewhere between 50% and 95% should be approved at cutoff=0.3
    # against a beta(2,8) distribution
    assert 0.5 < res.policy_cuts.approval_rate < 0.95
    # Stage 3 total $ <= Stage 2 total $
    assert res.policy_cuts_ladder.total_approved_dollars <= res.policy_cuts.total_approved_dollars
    # Predicted loss rate ($) should be lower than baseline (policy is removing high-risk apps)
    assert (res.policy_cuts.predicted_loss_rate_dollars
            < res.baseline.predicted_loss_rate_dollars)
