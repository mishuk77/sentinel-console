"""
Tests for the TASK-4A segment cascade logic.

Per the spec:
    For each application:
        If application matches a segment AND that segment has a defined policy:
            apply segment policy
        Else:
            apply global policy

    Multi-segment match: apply the MOST RESTRICTIVE (lowest threshold).

These tests focus on the resolver function in isolation — they don't
require a live DB or model to validate the resolution rules.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pytest

from app.services.decision_service import DecisionService


@dataclass
class _FakeSegment:
    id: str
    name: str
    is_active: bool = True
    is_global: bool = False
    filters: dict = None
    threshold: Optional[float] = None
    override_threshold: Optional[float] = None


@dataclass
class _FakePolicy:
    id: str
    threshold: float
    segments: list = None  # injected via mock


class _FakeQuery:
    """Minimal mock to stand in for SQLAlchemy query chains used in
    _resolve_segment_threshold. Supports .filter(), .order_by(), .all()
    so the production code's ORDER BY name clause doesn't break tests."""

    def __init__(self, results):
        self._results = results

    def filter(self, *args, **kwargs):
        return self

    def order_by(self, *args, **kwargs):
        # Production code orders by segment name for deterministic ties.
        # Mirror that here so the fake matches real DB behavior.
        return _FakeQuery(sorted(self._results, key=lambda s: s.name))

    def all(self):
        return self._results


class _FakeDB:
    def __init__(self, segments):
        self._segments = segments

    def query(self, _model_cls):
        return _FakeQuery(self._segments)


def _resolve(policy, segments, input_data):
    """Helper that wires DecisionService against a fake DB."""
    svc = DecisionService()
    db = _FakeDB(segments)
    return svc._resolve_segment_threshold(db, policy, input_data)


# ────────────────────────────────────────────────────────────────────────
# Cascade rules
# ────────────────────────────────────────────────────────────────────────


def test_no_matching_segment_falls_back_to_global():
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = [
        _FakeSegment(id="s1", name="High Income", filters={"income_band": "high"},
                     threshold=0.6),
    ]
    threshold, matched = _resolve(policy, segments, {"income_band": "low"})
    assert threshold == 0.5  # global fallback
    assert matched is None


def test_matching_segment_with_threshold_takes_precedence():
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = [
        _FakeSegment(id="s1", name="High Income", filters={"income_band": "high"},
                     threshold=0.7),
    ]
    threshold, matched = _resolve(policy, segments, {"income_band": "high"})
    assert threshold == 0.7
    assert matched == "High Income"


def test_matching_segment_without_threshold_falls_back_to_global():
    """A segment that matches but has neither threshold nor override
    falls back to global (segment is empty / undefined for policy purposes)."""
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = [
        _FakeSegment(id="s1", name="No-Policy Segment", filters={"channel": "retail"},
                     threshold=None, override_threshold=None),
    ]
    threshold, matched = _resolve(policy, segments, {"channel": "retail"})
    assert threshold == 0.5  # global fallback
    assert matched is None


def test_override_threshold_wins_over_system_threshold():
    """When both override_threshold and threshold are set, override wins."""
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = [
        _FakeSegment(
            id="s1", name="High Income",
            filters={"income_band": "high"},
            threshold=0.6,           # system-derived
            override_threshold=0.8,  # analyst override
        ),
    ]
    threshold, matched = _resolve(policy, segments, {"income_band": "high"})
    assert threshold == 0.8
    assert matched == "High Income"


def test_multi_segment_match_picks_most_restrictive():
    """When an applicant matches multiple segments with custom thresholds,
    apply the MOST RESTRICTIVE (lowest) and log a warning."""
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = [
        _FakeSegment(id="s1", name="High Income",
                     filters={"income_band": "high"}, threshold=0.7),
        _FakeSegment(id="s2", name="High Risk Region",
                     filters={"region": "northeast"}, threshold=0.4),
        _FakeSegment(id="s3", name="Self-Employed",
                     filters={"employment": "self_employed"}, threshold=0.6),
    ]
    # Applicant matches all three
    threshold, matched = _resolve(
        policy, segments,
        {"income_band": "high", "region": "northeast", "employment": "self_employed"},
    )
    assert threshold == 0.4  # most restrictive
    assert matched == "High Risk Region"


def test_segment_threshold_tie_break_is_deterministic():
    """When two segments have identical thresholds, the result must be
    deterministic across calls — required for audit reproducibility.
    Tiebreak rule: alphabetical by segment name."""
    policy = _FakePolicy(id="p1", threshold=0.5)
    # Three segments with the SAME threshold but different names.
    # Without a deterministic tiebreak, min() returns the first one in
    # iteration order, which depends on DB query ordering.
    segments = [
        _FakeSegment(id="s1", name="Zebra", filters={"x": "y"}, threshold=0.4),
        _FakeSegment(id="s2", name="Alpha", filters={"x": "y"}, threshold=0.4),
        _FakeSegment(id="s3", name="Mango", filters={"x": "y"}, threshold=0.4),
    ]
    # Run resolution multiple times — must produce the same result every time
    results = [_resolve(policy, segments, {"x": "y"}) for _ in range(5)]
    assert all(r == results[0] for r in results), \
        f"Non-deterministic tiebreak: got {results}"
    # With the alphabetical tiebreak, "Alpha" should win
    threshold, matched = results[0]
    assert threshold == 0.4
    assert matched == "Alpha"


def test_inactive_segment_ignored():
    """Inactive segments should not be considered in resolution.

    Note: our _FakeQuery doesn't actually run the filter — the real DB
    query filters out is_active=False rows. So this test passes a list
    that already excludes inactive ones, demonstrating the contract.
    """
    policy = _FakePolicy(id="p1", threshold=0.5)
    # An "inactive" segment is omitted from the segments list (the real
    # query filters it out with .filter(is_active==True))
    segments = []
    threshold, matched = _resolve(policy, segments, {"income_band": "high"})
    assert threshold == 0.5
    assert matched is None


def test_global_policy_only_returns_global_threshold():
    policy = _FakePolicy(id="p1", threshold=0.5)
    segments = []
    threshold, matched = _resolve(policy, segments, {"any": "value"})
    assert threshold == 0.5
    assert matched is None


def test_none_policy_returns_none():
    """Defensive: if no policy is provided, return (None, None)."""
    threshold, matched = _resolve(None, [], {"any": "value"})
    assert threshold is None
    assert matched is None


# ────────────────────────────────────────────────────────────────────────
# Filter matching
# ────────────────────────────────────────────────────────────────────────


def test_filter_exact_match():
    svc = DecisionService()
    assert svc._matches_segment({"income_band": "high"}, {"income_band": "high"}) is True
    assert svc._matches_segment({"income_band": "high"}, {"income_band": "low"}) is False


def test_filter_gte_op():
    svc = DecisionService()
    assert svc._matches_segment({"age": {"op": ">=", "value": 30}}, {"age": 35}) is True
    assert svc._matches_segment({"age": {"op": ">=", "value": 30}}, {"age": 25}) is False


def test_filter_in_op():
    svc = DecisionService()
    assert svc._matches_segment(
        {"region": {"op": "in", "values": ["NY", "MA", "CT"]}},
        {"region": "MA"},
    ) is True
    assert svc._matches_segment(
        {"region": {"op": "in", "values": ["NY", "MA", "CT"]}},
        {"region": "TX"},
    ) is False


def test_filter_multiple_conditions_all_must_match():
    svc = DecisionService()
    filters = {"region": "MA", "income_band": "high"}
    assert svc._matches_segment(filters, {"region": "MA", "income_band": "high"}) is True
    assert svc._matches_segment(filters, {"region": "MA", "income_band": "low"}) is False
    assert svc._matches_segment(filters, {"region": "NY", "income_band": "high"}) is False


def test_filter_missing_field_does_not_match():
    """If the filter requires a column the input doesn't have, no match."""
    svc = DecisionService()
    assert svc._matches_segment({"income_band": "high"}, {"region": "MA"}) is False
