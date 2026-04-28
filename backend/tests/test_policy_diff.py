"""
Tests for diff_policies — TASK-11G + TASK-11H.

Verifies that the row-level policy diff correctly identifies:
  * applicants newly approved by B vs A
  * applicants newly denied by B vs A
  * applicants approved by both with reduced amount under B
  * dollar volumes match the per-row movement
  * application ID lists are populated (capped to max_ids_per_bucket)
"""
from __future__ import annotations

import numpy as np
import pytest

from app.services.portfolio_simulation import (
    PolicyConfig,
    SimulationInputs,
    diff_policies,
)


def _population():
    """10 applications. Scores: 0.05..0.95. Amounts: $10k..$1k."""
    scores = np.array([
        0.05, 0.15, 0.25, 0.35, 0.45,
        0.55, 0.65, 0.75, 0.85, 0.95,
    ])
    amounts = np.array([
        10_000, 9_000, 8_000, 7_000, 6_000,
        5_000, 4_000, 3_000, 2_000, 1_000,
    ], dtype=float)
    ids = [f"APP_{i}" for i in range(10)]
    return SimulationInputs(scores=scores, requested_amounts=amounts, application_ids=ids)


# ────────────────────────────────────────────────────────────────────────
# Newly approved / newly denied
# ────────────────────────────────────────────────────────────────────────


def test_loosening_cutoff_produces_newly_approved():
    """Going from cutoff=0.3 → 0.7 newly approves rows 3..6 (scores 0.35..0.65)."""
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.3),
        policy_b=PolicyConfig(cutoff=0.7),
    )
    # Rows 3, 4, 5, 6 (scores 0.35, 0.45, 0.55, 0.65) move from denied → approved
    assert diff.newly_approved_count == 4
    assert diff.newly_denied_count == 0
    assert "APP_3" in diff.newly_approved_ids
    assert "APP_6" in diff.newly_approved_ids


def test_tightening_cutoff_produces_newly_denied():
    """Going from cutoff=0.7 → 0.3 denies rows 3..6 that were previously approved."""
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.7),
        policy_b=PolicyConfig(cutoff=0.3),
    )
    assert diff.newly_denied_count == 4
    assert diff.newly_approved_count == 0
    assert "APP_3" in diff.newly_denied_ids
    assert "APP_6" in diff.newly_denied_ids


def test_no_change_when_policies_identical():
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.5),
        policy_b=PolicyConfig(cutoff=0.5),
    )
    assert diff.newly_approved_count == 0
    assert diff.newly_denied_count == 0
    assert diff.reduced_amount_count == 0


def test_dollar_volumes_match_amounts():
    """Newly approved dollars must equal the sum of amounts of newly approved rows."""
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.3),
        policy_b=PolicyConfig(cutoff=0.7),
    )
    # Newly approved rows are 3, 4, 5, 6 → $7k + $6k + $5k + $4k = $22k
    assert diff.newly_approved_dollars == pytest.approx(22_000)


# ────────────────────────────────────────────────────────────────────────
# Reduced amount (ladder)
# ────────────────────────────────────────────────────────────────────────


def test_ladder_reduces_amount_for_some_approved():
    """Approve everyone (cutoff=1.0). Add a tight ladder to policy B → some
    approved rows get reduced amounts."""
    inp = _population()

    # Policy A — no ladder
    pa = PolicyConfig(cutoff=1.0)

    # Policy B — cap each decile at $500
    flat_ladder = {d: 500.0 for d in range(1, 11)}
    pb = PolicyConfig(cutoff=1.0, amount_ladder=flat_ladder)

    diff = diff_policies(inp, pa, pb)

    # Every approved row's amount drops to $500. Total reduction = sum(amount - 500) for amount>500
    assert diff.reduced_amount_count > 0
    assert diff.reduced_amount_total_reduction is not None
    assert diff.reduced_amount_total_reduction > 0


def test_ladder_with_higher_caps_no_reduction():
    """If the ladder cap is above every requested amount, no reductions."""
    inp = _population()
    high_ladder = {d: 1_000_000 for d in range(1, 11)}
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=1.0),
        policy_b=PolicyConfig(cutoff=1.0, amount_ladder=high_ladder),
    )
    assert diff.reduced_amount_count == 0
    assert diff.reduced_amount_total_reduction == pytest.approx(0.0)


# ────────────────────────────────────────────────────────────────────────
# Mode 3 — no requested amounts
# ────────────────────────────────────────────────────────────────────────


def test_mode_3_no_dollar_metrics():
    scores = np.array([0.1, 0.3, 0.5, 0.7, 0.9])
    inp = SimulationInputs(scores=scores, requested_amounts=None,
                           application_ids=[f"R{i}" for i in range(5)])
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.4),
        policy_b=PolicyConfig(cutoff=0.7),
    )
    assert diff.newly_approved_count == 1  # row at score=0.5
    assert diff.newly_approved_dollars is None
    assert diff.reduced_amount_total_reduction is None


# ────────────────────────────────────────────────────────────────────────
# ID list capping
# ────────────────────────────────────────────────────────────────────────


def test_id_list_capped_at_limit():
    """Generate a population of 5000 rows and verify the ID lists are
    capped at max_ids_per_bucket."""
    rng = np.random.default_rng(0)
    n = 5000
    scores = rng.beta(2, 5, size=n)
    inp = SimulationInputs(
        scores=scores,
        requested_amounts=np.full(n, 5000.0),
        application_ids=[f"APP_{i}" for i in range(n)],
    )
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.2),
        policy_b=PolicyConfig(cutoff=0.5),
        max_ids_per_bucket=50,
    )
    # The cap caps the ID list, but counts are still exact
    assert len(diff.newly_approved_ids) <= 50
    assert diff.newly_approved_count > 50  # so the cap was actually triggered


# ────────────────────────────────────────────────────────────────────────
# Aggregate metrics included for context
# ────────────────────────────────────────────────────────────────────────


def test_diff_includes_full_stage_metrics_for_both_policies():
    """The diff response includes the StageMetrics for both A and B so the
    UI can render side-by-side aggregates without a second API call."""
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.3),
        policy_b=PolicyConfig(cutoff=0.7),
    )
    assert diff.policy_a.stage_name == "policy_a"
    assert diff.policy_b.stage_name == "policy_b"
    # Approval count under B should match a regular simulation
    assert diff.policy_b.approval_count == 7  # cutoff=0.7 → first 7 rows
    assert diff.policy_a.approval_count == 3  # cutoff=0.3 → first 3 rows


def test_diff_serializes_to_dict():
    """to_dict() must produce JSON-serializable output for API responses."""
    import json
    inp = _population()
    diff = diff_policies(
        inp,
        policy_a=PolicyConfig(cutoff=0.3),
        policy_b=PolicyConfig(cutoff=0.7),
    )
    d = diff.to_dict()
    json.dumps(d)  # must not raise
    assert "newly_approved_count" in d
    assert "policy_a" in d
    assert "policy_b" in d
