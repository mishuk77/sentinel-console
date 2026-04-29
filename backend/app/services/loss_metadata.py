"""
loss_metadata — resolve the dollar-handling mode for a given (model, dataset)
pair and produce loss values consistently across the platform.

Spec reference: TASK-6 (Outcome flag and loss amount handling)

Three modes, in priority order
------------------------------

Mode 1 — Loss amount column provided.
    The dataset (or model.loss_amount_column) identifies a column that holds
    the actual dollar amount lost when the bad event occurred.
    observed_loss_$ = sum(loss_amount where outcome_flag = 1)
    This is the most accurate option and overrides Mode 2 when both are
    available.

Mode 2 — Approved/principal amount column provided.
    The dataset identifies a column carrying the approved or principal
    amount. We assume full principal at risk on default — the standard
    credit assumption when LGD data isn't available.
    observed_loss_$ = sum(approved_amount where outcome_flag = 1)

Mode 3 — Neither column available.
    Only count-based metrics are produced. Dollar metrics in the UI
    display "N/A — no loss amount or approved amount column in dataset."

Predicted loss is always:
    predicted_loss_$ = approved_amount × predicted_probability

If the approved amount is unavailable (Mode 3 with no approved-amount column),
predicted_loss_$ shows "N/A" in the UI and only count-based predicted loss is
exposed.

Usage
-----

    resolution = resolve_loss_handling(model, dataset)
    if resolution.mode == "mode_1":
        # use resolution.loss_amount_column directly
        ...
    elif resolution.mode == "mode_2":
        # use resolution.approved_amount_column × outcome_flag
        ...
    else:
        # mode_3: count metrics only
        ...

    # User-facing footnote text (TASK-6 acceptance criterion)
    footnote = resolution.ui_footnote()
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Literal, Optional, TYPE_CHECKING

if TYPE_CHECKING:
    from app.models.ml_model import MLModel
    from app.models.dataset import Dataset


LossMode = Literal["mode_1", "mode_2", "mode_3"]


@dataclass(frozen=True)
class LossHandlingResolution:
    """The result of resolving how dollar metrics will be computed for a
    (model, dataset) pair. Immutable so it can be passed around safely."""

    mode: LossMode
    target_column: Optional[str]
    approved_amount_column: Optional[str]
    loss_amount_column: Optional[str]

    # Whether predicted dollar metrics can be computed (requires approved
    # amount to be available)
    can_compute_predicted_dollars: bool

    # Whether observed dollar metrics can be computed (requires either Mode 1
    # or Mode 2)
    can_compute_observed_dollars: bool

    def ui_footnote(self) -> str:
        """Human-readable footnote that appears in the UI wherever dollar
        metrics are displayed. Plain language — no internal mode numbers."""
        if self.mode == "mode_1":
            return (
                f"Dollar metrics use the {self.loss_amount_column!r} column "
                f"(actual loss amount per defaulted application)."
            )
        if self.mode == "mode_2":
            return (
                f"Loss = {self.approved_amount_column!r} × predicted probability "
                f"(full principal at risk on default)."
            )
        return (
            "Dollar metrics unavailable — tag an approved-amount or loss-amount "
            "column on this dataset to enable dollar-based reporting."
        )


def resolve_loss_handling(
    model: Optional["MLModel"],
    dataset: Optional["Dataset"],
) -> LossHandlingResolution:
    """
    Decide which mode to use for the given (model, dataset) pair.

    Parameters
    ----------
    model : MLModel | None
        The model whose target_column drives outcome interpretation. If None,
        no target reference is available and only the dataset's metadata is
        used.
    dataset : Dataset | None
        The dataset providing the approved-amount and loss-amount column
        annotations.

    Returns
    -------
    LossHandlingResolution
        Mode + the resolved column references + capability flags.

    Resolution priority (per TASK-6 spec)
    ------------------------------------
    1. If model.loss_amount_column OR dataset.loss_amount_column is set,
       Mode 1 (use that column directly).
    2. Else if dataset.approved_amount_column is set, Mode 2 (full principal).
    3. Else Mode 3 (count metrics only).

    The model field takes precedence over the dataset field when both are
    set, since the model represents the user's most recent explicit choice.
    """
    target_col = getattr(model, "target_column", None) if model else None

    loss_col = (
        getattr(model, "loss_amount_column", None) if model else None
    ) or (
        getattr(dataset, "loss_amount_column", None) if dataset else None
    )
    approved_col = getattr(dataset, "approved_amount_column", None) if dataset else None

    if loss_col:
        return LossHandlingResolution(
            mode="mode_1",
            target_column=target_col,
            approved_amount_column=approved_col,
            loss_amount_column=loss_col,
            can_compute_predicted_dollars=approved_col is not None,
            can_compute_observed_dollars=True,
        )
    if approved_col:
        return LossHandlingResolution(
            mode="mode_2",
            target_column=target_col,
            approved_amount_column=approved_col,
            loss_amount_column=None,
            can_compute_predicted_dollars=True,
            can_compute_observed_dollars=target_col is not None,
        )
    return LossHandlingResolution(
        mode="mode_3",
        target_column=target_col,
        approved_amount_column=None,
        loss_amount_column=None,
        can_compute_predicted_dollars=False,
        can_compute_observed_dollars=False,
    )


# ─────────────────────────────────────────────────────────────────────────
# Common heuristics for auto-detection at upload time
# ─────────────────────────────────────────────────────────────────────────
#
# These are SUGGESTIONS shown to the user in the UI. The user must confirm
# the choice — auto-detection alone is not authoritative. (TASK-6 spec
# explicitly forbids silent auto-detection of the outcome flag itself.)

_APPROVED_AMOUNT_NAME_HINTS = (
    "loan_amount", "approved_amount", "principal", "amount_approved",
    "balance", "limit", "amount", "loan_amt",
)
_LOSS_AMOUNT_NAME_HINTS = (
    "loss_amount", "charge_off_amount", "net_loss", "loss_dollars",
    "amount_lost", "writeoff_amount",
)
_ID_COLUMN_NAME_HINTS = (
    "application_id", "applicant_id", "id", "customer_id", "account_id",
    "loan_id",
)


def suggest_approved_amount_column(columns: list[str]) -> Optional[str]:
    """Return the first column name (case-insensitive) that matches one of
    the common approved-amount conventions, or None if no match. The user
    can override the suggestion in the UI."""
    return _first_match(columns, _APPROVED_AMOUNT_NAME_HINTS)


def suggest_loss_amount_column(columns: list[str]) -> Optional[str]:
    return _first_match(columns, _LOSS_AMOUNT_NAME_HINTS)


def suggest_id_column(columns: list[str]) -> Optional[str]:
    return _first_match(columns, _ID_COLUMN_NAME_HINTS)


def _first_match(columns: list[str], hints: tuple) -> Optional[str]:
    lower_to_orig = {c.lower(): c for c in columns}
    for hint in hints:
        if hint in lower_to_orig:
            return lower_to_orig[hint]
    return None
