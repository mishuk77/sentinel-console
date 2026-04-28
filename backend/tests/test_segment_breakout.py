"""
Tests for TASK-11F segment breakout — break_out_by_dimension().

Most important assertion: the sum of per-segment metrics equals the
portfolio total. This is the TASK-11B reconciliation rule applied to
breakouts, and it's required by the TASK-11F spec acceptance criteria.
"""
from __future__ import annotations

import numpy as np
import pytest

from app.services.portfolio_simulation import (
    PolicyConfig,
    SimulationInputs,
    break_out_by_dimension,
    simulate_portfolio,
)


@pytest.fixture
def labelled_population():
    """20 applications across 4 channels. Scores spread 0..1, amounts
    spread $1k..$20k, channel assignments deterministic."""
    rng = np.random.default_rng(0)
    n = 20
    scores = np.linspace(0.05, 0.95, n)
    amounts = np.linspace(1000, 20_000, n)
    channels = ["online", "branch", "broker", "partner"] * 5
    inp = SimulationInputs(
        scores=scores,
        requested_amounts=amounts,
        application_ids=[f"APP_{i}" for i in range(n)],
    )
    return inp, channels


# ────────────────────────────────────────────────────────────────────────
# Reconciliation: sum(segment_metrics) == portfolio_total
# ────────────────────────────────────────────────────────────────────────


def test_segment_application_counts_sum_to_total(labelled_population):
    inp, channels = labelled_population
    breakouts = break_out_by_dimension(
        inp,
        policy=PolicyConfig(cutoff=0.6),
        dimension_values=channels,
        dimension_label="channel",
    )
    total_n = sum(b.n_applications for b in breakouts)
    assert total_n == len(inp.scores)


def test_segment_approval_counts_sum_to_portfolio_count(labelled_population):
    """Per TASK-11B: sum of per-segment approval counts must equal the
    portfolio total approval count (within zero — it's an integer)."""
    inp, channels = labelled_population
    policy = PolicyConfig(cutoff=0.6)

    portfolio = simulate_portfolio(inp, policy)
    breakouts = break_out_by_dimension(
        inp, policy, channels, "channel", stage="policy_cuts_ladder",
    )
    sum_approved = sum(b.metrics.approval_count for b in breakouts)
    assert sum_approved == portfolio.policy_cuts_ladder.approval_count


def test_segment_dollar_metrics_sum_to_portfolio_total(labelled_population):
    """Per TASK-11F acceptance: 'Segment rows sum to the rolled-up total.'"""
    inp, channels = labelled_population
    policy = PolicyConfig(cutoff=0.7)

    portfolio = simulate_portfolio(inp, policy)
    breakouts = break_out_by_dimension(
        inp, policy, channels, "channel", stage="policy_cuts_ladder",
    )
    sum_approved_dollars = sum(
        (b.metrics.total_approved_dollars or 0) for b in breakouts
    )
    sum_loss_dollars = sum(
        (b.metrics.total_predicted_loss_dollars or 0) for b in breakouts
    )

    assert sum_approved_dollars == pytest.approx(
        portfolio.policy_cuts_ladder.total_approved_dollars, rel=1e-9
    )
    assert sum_loss_dollars == pytest.approx(
        portfolio.policy_cuts_ladder.total_predicted_loss_dollars, rel=1e-9
    )


def test_segment_loss_count_sum_to_portfolio_loss_count(labelled_population):
    """Predicted loss count (expected count of defaults) must sum across
    segments to the portfolio total."""
    inp, channels = labelled_population
    policy = PolicyConfig(cutoff=0.7)

    portfolio = simulate_portfolio(inp, policy)
    breakouts = break_out_by_dimension(inp, policy, channels, "channel")

    sum_loss_count = sum(b.metrics.predicted_loss_count for b in breakouts)
    assert sum_loss_count == pytest.approx(
        portfolio.policy_cuts_ladder.predicted_loss_count, rel=1e-9
    )


# ────────────────────────────────────────────────────────────────────────
# Stage selection
# ────────────────────────────────────────────────────────────────────────


def test_baseline_stage_approves_everyone_per_segment(labelled_population):
    """Baseline stage approves every applicant — segment approval rate = 100%."""
    inp, channels = labelled_population
    breakouts = break_out_by_dimension(
        inp, PolicyConfig(cutoff=0.5), channels, "channel", stage="baseline",
    )
    for b in breakouts:
        assert b.metrics.approval_rate == pytest.approx(1.0)


def test_policy_cuts_stage_no_ladder(labelled_population):
    """policy_cuts stage applies cutoff but not ladder — should match
    portfolio policy_cuts."""
    inp, channels = labelled_population
    policy = PolicyConfig(cutoff=0.5, amount_ladder={1: 1, 2: 1})  # cheap ladder
    portfolio = simulate_portfolio(inp, policy)
    breakouts = break_out_by_dimension(
        inp, policy, channels, "channel", stage="policy_cuts",
    )
    sum_approved = sum(
        (b.metrics.total_approved_dollars or 0) for b in breakouts
    )
    # policy_cuts stage doesn't apply the ladder, so approved $ should
    # match the portfolio's policy_cuts (ladder-free) total
    assert sum_approved == pytest.approx(
        portfolio.policy_cuts.total_approved_dollars, rel=1e-9
    )


# ────────────────────────────────────────────────────────────────────────
# Edge cases
# ────────────────────────────────────────────────────────────────────────


def test_single_segment_value_returns_one_breakout():
    """All applicants in the same segment → one breakout that equals the
    portfolio."""
    n = 100
    rng = np.random.default_rng(42)
    inp = SimulationInputs(
        scores=rng.beta(2, 5, size=n),
        requested_amounts=rng.lognormal(8, 0.3, n),
    )
    breakouts = break_out_by_dimension(
        inp, PolicyConfig(cutoff=0.4),
        dimension_values=["x"] * n,
        dimension_label="constant",
    )
    assert len(breakouts) == 1
    assert breakouts[0].n_applications == n


def test_dimension_length_mismatch_raises():
    inp = SimulationInputs(
        scores=np.array([0.1, 0.2, 0.3]),
        requested_amounts=np.array([1.0, 2.0, 3.0]),
    )
    with pytest.raises(ValueError, match="length"):
        break_out_by_dimension(
            inp, PolicyConfig(cutoff=0.5),
            dimension_values=["a", "b"],  # wrong length
            dimension_label="x",
        )


def test_breakout_serializable_to_dict(labelled_population):
    """Required for API responses — must round-trip through json.dumps."""
    import json
    inp, channels = labelled_population
    breakouts = break_out_by_dimension(
        inp, PolicyConfig(cutoff=0.5), channels, "channel",
    )
    serialized = [b.to_dict() for b in breakouts]
    json.dumps(serialized)  # must not raise


def test_breakout_handles_mode_3_no_amounts():
    """When requested_amounts is None, dollar metrics are None per segment
    but counts still work."""
    inp = SimulationInputs(
        scores=np.array([0.1, 0.3, 0.5, 0.7, 0.9]),
        requested_amounts=None,
    )
    breakouts = break_out_by_dimension(
        inp, PolicyConfig(cutoff=0.6),
        dimension_values=["a", "a", "b", "b", "b"],
        dimension_label="grp",
    )
    for b in breakouts:
        assert b.metrics.total_approved_dollars is None
        assert isinstance(b.metrics.approval_count, int)
