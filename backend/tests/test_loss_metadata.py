"""
Tests for the TASK-6 three-mode loss handling resolver.

Mode 1 — explicit loss-amount column (most accurate)
Mode 2 — approved-amount column with full-principal-at-risk assumption
Mode 3 — neither column available; only count metrics

Tests cover the resolution priority, the "model field takes precedence over
dataset field" rule, and the UI footnote text the spec requires.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional

import pytest

from app.services.loss_metadata import (
    resolve_loss_handling,
    suggest_approved_amount_column,
    suggest_id_column,
    suggest_loss_amount_column,
)


@dataclass
class _FakeModel:
    target_column: Optional[str] = None
    loss_amount_column: Optional[str] = None


@dataclass
class _FakeDataset:
    approved_amount_column: Optional[str] = None
    loss_amount_column: Optional[str] = None


# ────────────────────────────────────────────────────────────────────────
# Mode resolution
# ────────────────────────────────────────────────────────────────────────

def test_mode_1_when_dataset_has_loss_amount_column():
    """Loss-amount column on the dataset → Mode 1."""
    model = _FakeModel(target_column="charge_off")
    dataset = _FakeDataset(
        approved_amount_column="loan_amount",
        loss_amount_column="charge_off_amount",
    )
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_1"
    assert res.loss_amount_column == "charge_off_amount"
    assert res.approved_amount_column == "loan_amount"
    assert res.can_compute_observed_dollars is True
    assert res.can_compute_predicted_dollars is True


def test_mode_1_when_model_has_loss_amount_column():
    """Loss-amount column on the model → Mode 1 (model field takes precedence
    over dataset field, per TASK-6 priority rules)."""
    model = _FakeModel(target_column="charge_off", loss_amount_column="net_loss")
    dataset = _FakeDataset(approved_amount_column="loan_amount")
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_1"
    assert res.loss_amount_column == "net_loss"


def test_mode_1_model_overrides_dataset_loss_amount():
    """When both model and dataset have a loss column, model wins (more
    recent explicit choice)."""
    model = _FakeModel(loss_amount_column="model_chosen_loss_col")
    dataset = _FakeDataset(loss_amount_column="dataset_loss_col")
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_1"
    assert res.loss_amount_column == "model_chosen_loss_col"


def test_mode_2_when_only_approved_amount_present():
    """No loss column anywhere, but dataset has approved amount → Mode 2."""
    model = _FakeModel(target_column="charge_off")
    dataset = _FakeDataset(approved_amount_column="loan_amount")
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_2"
    assert res.approved_amount_column == "loan_amount"
    assert res.loss_amount_column is None
    assert res.can_compute_predicted_dollars is True
    assert res.can_compute_observed_dollars is True  # target is set


def test_mode_2_observed_dollars_unavailable_without_target():
    """Mode 2 + no target_column → observed dollars cannot be computed."""
    model = _FakeModel(target_column=None)
    dataset = _FakeDataset(approved_amount_column="loan_amount")
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_2"
    assert res.can_compute_observed_dollars is False
    assert res.can_compute_predicted_dollars is True


def test_mode_3_when_no_columns_set():
    """Neither loss nor approved amount → Mode 3."""
    model = _FakeModel(target_column="charge_off")
    dataset = _FakeDataset()
    res = resolve_loss_handling(model, dataset)
    assert res.mode == "mode_3"
    assert res.can_compute_predicted_dollars is False
    assert res.can_compute_observed_dollars is False


def test_mode_3_when_model_and_dataset_are_none():
    """Defensive: handle missing model/dataset gracefully."""
    res = resolve_loss_handling(None, None)
    assert res.mode == "mode_3"
    assert res.target_column is None


# ────────────────────────────────────────────────────────────────────────
# UI footnote text (TASK-6 acceptance criterion)
# ────────────────────────────────────────────────────────────────────────

def test_ui_footnote_mode_1_describes_loss_column():
    res = resolve_loss_handling(
        _FakeModel(loss_amount_column="charge_off_amount"),
        _FakeDataset(approved_amount_column="loan_amount"),
    )
    footnote = res.ui_footnote()
    assert "Mode 1" in footnote
    assert "charge_off_amount" in footnote
    assert "actual loss amount" in footnote


def test_ui_footnote_mode_2_describes_full_principal():
    res = resolve_loss_handling(
        _FakeModel(target_column="charge_off"),
        _FakeDataset(approved_amount_column="loan_amount"),
    )
    footnote = res.ui_footnote()
    assert "Mode 2" in footnote
    assert "loan_amount" in footnote
    assert "charge_off" in footnote
    assert "full principal at risk" in footnote


def test_ui_footnote_mode_3_explains_unavailable():
    res = resolve_loss_handling(_FakeModel(), _FakeDataset())
    footnote = res.ui_footnote()
    assert "Mode 3" in footnote
    assert "unavailable" in footnote
    assert "Annotate the dataset" in footnote


# ────────────────────────────────────────────────────────────────────────
# Auto-detection heuristics for upload UI
# ────────────────────────────────────────────────────────────────────────

def test_suggest_approved_amount_column_finds_common_names():
    cols = ["application_id", "income", "loan_amount", "score"]
    assert suggest_approved_amount_column(cols) == "loan_amount"


def test_suggest_approved_amount_column_case_insensitive():
    cols = ["Application_ID", "Loan_Amount"]
    assert suggest_approved_amount_column(cols) == "Loan_Amount"


def test_suggest_approved_amount_column_returns_none_when_no_match():
    cols = ["foo", "bar", "baz"]
    assert suggest_approved_amount_column(cols) is None


def test_suggest_loss_amount_column():
    cols = ["application_id", "charge_off_amount", "score"]
    assert suggest_loss_amount_column(cols) == "charge_off_amount"


def test_suggest_id_column_prioritizes_application_id():
    cols = ["customer_id", "application_id", "id"]
    # application_id comes first in the hint list, so it should be picked
    assert suggest_id_column(cols) == "application_id"


def test_suggest_id_column_falls_back_to_id():
    cols = ["foo", "id", "bar"]
    assert suggest_id_column(cols) == "id"
