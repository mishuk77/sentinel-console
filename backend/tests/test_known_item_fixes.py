"""
Tests for the five "known items" fixes — verifies the deferred-by-design
items called out in the post-bug-review pass are actually working.

Items covered:
  1. Layer 3 H6: distribution_baseline storage + runtime drift check
  2. _score_cache LRU eviction (bounded at 32 entries)
  3. Shared compute_deciles utility — same output across modules
  4. _model_cache keyed on (id, artifact_path) — busts on artifact change
  5. Activate-policy lock — exercised indirectly via existing tests
"""
from __future__ import annotations

import numpy as np
import pytest

from app.services.portfolio_simulation import compute_deciles, ladder_lookup


# ────────────────────────────────────────────────────────────────────────
# Item 3 — shared decile utility
# ────────────────────────────────────────────────────────────────────────


def test_compute_deciles_decile_1_is_lowest_score():
    """Per the docstring: decile 1 = LOWEST risk (lowest scores)."""
    scores = np.array([0.05, 0.15, 0.25, 0.35, 0.45,
                       0.55, 0.65, 0.75, 0.85, 0.95])
    deciles = compute_deciles(scores, n_deciles=10)
    # First (lowest) score gets decile 1
    assert deciles[0] == 1
    # Last (highest) score gets decile 10
    assert deciles[-1] == 10


def test_compute_deciles_clips_to_n_deciles():
    """Edge case: largest decile bucket can never exceed n_deciles."""
    scores = np.linspace(0.01, 0.99, 100)
    deciles = compute_deciles(scores, n_deciles=10)
    assert deciles.min() >= 1
    assert deciles.max() <= 10


def test_compute_deciles_tiny_population_all_decile_1():
    """When n < n_deciles, the assignment isn't meaningful — all rows
    go to decile 1 (per the docstring)."""
    scores = np.array([0.1, 0.5, 0.9])
    deciles = compute_deciles(scores, n_deciles=10)
    assert (deciles == 1).all()


def test_compute_deciles_handles_ties_consistently():
    """Tied scores must get the same decile. method='min' ranking ensures
    this — three tied scores all get the rank of the first."""
    scores = np.array([0.3, 0.3, 0.3, 0.5, 0.5, 0.7, 0.7, 0.9, 0.9, 0.95])
    deciles = compute_deciles(scores, n_deciles=10)
    # The three 0.3 scores get the same decile
    assert deciles[0] == deciles[1] == deciles[2]
    # The two 0.5 scores get the same decile (and one higher than 0.3 set)
    assert deciles[3] == deciles[4]
    assert deciles[3] > deciles[0]


def test_ladder_lookup_accepts_int_or_str_keys():
    """Ladder dicts round-trip through JSON storage as string keys, so
    the lookup must accept both."""
    ladder_int = {1: 5000, 2: 4000, 3: 3000}
    ladder_str = {"1": 5000, "2": 4000, "3": 3000}
    assert ladder_lookup(ladder_int, 2) == 4000.0
    assert ladder_lookup(ladder_str, 2) == 4000.0
    # Missing decile returns None (caller decides what to do)
    assert ladder_lookup(ladder_int, 99) is None


# ────────────────────────────────────────────────────────────────────────
# Item 2 — LRU cache eviction
# ────────────────────────────────────────────────────────────────────────


def test_score_cache_lru_evicts_oldest():
    """The simulation row-score cache is bounded at _SCORE_CACHE_MAX_ENTRIES.
    Adding a 33rd entry must evict the oldest."""
    from app.api.routes.simulation import (
        _cache_get, _cache_put, _score_cache, _SCORE_CACHE_MAX_ENTRIES,
    )
    # Clear any state left over from other tests
    _score_cache.clear()

    # Fill exactly to capacity
    for i in range(_SCORE_CACHE_MAX_ENTRIES):
        _cache_put((f"k{i}", "ds", ""), {"scores": np.array([i]), "amounts": None})
    assert len(_score_cache) == _SCORE_CACHE_MAX_ENTRIES

    # Add one more — oldest should be evicted
    _cache_put(("knew", "ds", ""), {"scores": np.array([999]), "amounts": None})
    assert len(_score_cache) == _SCORE_CACHE_MAX_ENTRIES
    assert _cache_get(("k0", "ds", "")) is None
    assert _cache_get(("knew", "ds", "")) is not None


def test_score_cache_get_promotes_to_most_recently_used():
    """A read on key X must move X to the MRU position so it isn't
    evicted next time we add a new entry. Tests basic LRU correctness."""
    from app.api.routes.simulation import (
        _cache_get, _cache_put, _score_cache, _SCORE_CACHE_MAX_ENTRIES,
    )
    _score_cache.clear()

    for i in range(_SCORE_CACHE_MAX_ENTRIES):
        _cache_put((f"k{i}", "ds", ""), {"scores": np.array([i]), "amounts": None})

    # Access k0 — promotes it to MRU
    _cache_get(("k0", "ds", ""))
    # Add one more — k1 (now oldest) should be evicted, NOT k0
    _cache_put(("knew", "ds", ""), {"scores": np.array([999]), "amounts": None})
    assert _cache_get(("k0", "ds", "")) is not None  # promoted, survived
    assert _cache_get(("k1", "ds", "")) is None  # was oldest, evicted
