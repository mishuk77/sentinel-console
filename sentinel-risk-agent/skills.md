# Skills inventory — Credit Risk Analyst Agent

Each skill is a discrete, named capability with a clear input/output
contract. Skills are the unit of reuse: the orchestrator composes them;
sub-agents call them.

For each skill below: **input → output**, when used, whether the
implementation is deterministic (D) or LLM-driven (L), and the model
size where applicable.

---

## Bucket A — Data understanding (Stage 1, 2)

### `profile_data` (D)
**Input**: CSV path or `dataset_id`.
**Output**:
```json
{
  "n_rows": 30000,
  "columns": [
    {"name": "fico", "dtype": "int", "missing_pct": 0.0,
     "cardinality": 312, "min": 350, "max": 850, "p50": 695, "p95": 800,
     "is_binary": false, "is_numeric_realistic": true,
     "candidate_amount": false, "candidate_target": false,
     "candidate_id": false, "candidate_segment": false}
  ]
}
```
**When**: stage 1, always first.
**Notes**: pure pandas; no LLM. The candidacy flags are simple heuristics
that downstream LLM skills use as priors.

### `detect_target` (L, Sonnet)
**Input**: column profile.
**Output**: ranked list of candidate targets with confidence.
**When**: stage 2.
**Reasoning**: name patterns (`charge_off`, `default`, `bad`, `target`,
`label`), is_binary, base rate plausibility (1%–60%), absence from
"obvious feature" list (FICO, income, etc.).

### `detect_amount_column` (D)
**Input**: column profile.
**Output**: best amount column candidate or null.
**When**: stage 1.
**Reasoning**: positive numeric, name patterns (`amount`, `principal`,
`balance`, `loan`), realistic range ($100–$1M), low missingness.

### `detect_segmenting_columns` (D)
**Input**: column profile.
**Output**: ranked list of low-cardinality categoricals suitable for
segmentation.
**When**: stage 1, surfaced again in stage 7.
**Reasoning**: cardinality 2–50, categorical dtype, sufficient samples
per level (>500 rows).

### `flag_leakage` (L, Opus)
**Input**: column profile + chosen target.
**Output**: list of features the agent suspects of leakage with reason
codes.
**When**: stage 3.
**Reasoning**: known post-decision fields (chargeoff_date,
collections_status, ever_30dpd), perfect or near-perfect correlation
with target, future-dated columns.

### `score_feature_quality` (D)
**Input**: feature column + target column.
**Output**: information value, monotonicity, fill rate, KS by feature.
**When**: stage 3.
**Notes**: standard credit-risk feature evaluation; no LLM needed.

---

## Bucket B — Model selection (Stage 4, 5)

### `train_models` (D)
**Input**: dataset_id, target_col, feature_cols list.
**Output**: list of trained model entities with metrics.
**When**: stage 4.
**Implementation note**: delegates to `sentinel-qa/walker.py`'s
`step_build_train` — same poll loop, same status detection. Reuse
verbatim, do not reimplement.

### `compare_models` (L, Sonnet)
**Input**: list of model metric dicts.
**Output**: ranked list with composite score and a one-paragraph
rationale per ranking.
**When**: stage 5.
**Reasoning**: composite of AUC, KS, calibration error, and a
simplicity prior (LR > GBM > ensemble unless meaningfully better).

### `find_operating_points` (D)
**Input**: model calibration bins + business constraints (target
approval, max loss).
**Output**: list of (cutoff, decile, approval_rate, expected_loss_rate,
rationale).
**When**: stage 6.

---

## Bucket C — Policy reasoning (Stage 6, 7, 8)

### `apply_business_constraints` (L, Opus)
**Input**: operating points + constraints (or default priors).
**Output**: chosen cutoff with reasoning.
**When**: stage 6.
**Reasoning**: matches against constraint ladder ("absolutely no >X%
loss" beats "approve at least Y%" beats "maximize net yield"). LLM
chooses among feasible points.

### `recommend_cutoff` (L, Opus)
**Input**: chosen operating point + alternatives.
**Output**: section of memo defending cutoff.
**When**: stage 6.
**Notes**: writes one paragraph + a "why not the next decile up/down"
counter-argument.

### `discover_segments` (L, Opus)
**Input**: dataset, segmenting columns, model scores, target.
**Output**: list of recommended segment definitions with predicted
lift.
**When**: stage 7.
**Reasoning**: per candidate segment level, statistical test of
conditional default rate vs global, sample-size adjusted. Recommend
only when n >= 200 AND |conditional - global| > 2pp AND p < 0.05.

### `build_amount_ladder` (D)
**Input**: risk × amount cross-tab + base rate constraint.
**Output**: monotone ladder dict (decile → max amount).
**When**: stage 8.
**Reasoning**: optimization problem — minimize expected loss subject
to monotonicity and a minimum-amount constraint per decile.

---

## Bucket D — Risk review (Stage 9)

### `stress_test_policy` (D + L)
**Input**: policy + model + dataset.
**Output**: scenario table (base rate ±20%, prime mix shift, etc.) with
implications.
**When**: stage 9.
**Notes**: deterministic recomputation, LLM narrates.

### `disparate_impact_check` (L, Opus)
**Input**: dataset (with demographic proxies if present), policy.
**Output**: per-class adverse impact ratio + mitigation suggestions.
**When**: stage 9.
**Reasoning**: only runs when proxy columns exist. Reports 80% rule
ratios per class. Suggests segment-specific calibration as the
mitigation lever.

### `concentration_check` (D)
**Input**: portfolio under recommended policy.
**Output**: top-N segment concentration, Herfindahl, geographic
concentration.

### `drift_posture` (L, Sonnet)
**Input**: model + dataset characteristics.
**Output**: recommended retraining cadence + monitoring set-up.

---

## Bucket E — Output (post-stage 9)

### `write_memo_section` (L, Opus)
**Input**: stage outputs (structured) + skeleton template.
**Output**: a polished markdown section.
**When**: after each stage; or once at the end.
**Style guide**: see `PLAN.md` §4 for the memo skeleton. Tone is "smart
analyst writing for a CRO" — defensible, hedged where appropriate, no
puffery, no jargon without translation.

### `compose_memo` (L, Opus)
**Input**: every section.
**Output**: final memo, including the executive summary and the human
review checklist.
**When**: terminal step.
**Notes**: the executive summary is composed LAST, after every section
exists, so it can faithfully summarise.

### `produce_audit_trail` (D)
**Input**: in-run logs.
**Output**: `decisions.jsonl` + `api-calls.jsonl` files in the run
directory.

---

## Skill design principles

1. **One responsibility each.** A skill that "does the policy" is too
   coarse; split it into find-points / apply-constraints / write-memo.
2. **Determinism before reasoning.** Anything a deterministic check
   can answer (does this column have NaNs?) goes in a D-skill so the
   LLM doesn't waste a turn confirming it.
3. **Reasoning skills explain themselves.** Every L-skill returns a
   `rationale` field alongside its decision. That field flows directly
   into the memo with light editing.
4. **Skills don't side-effect by default.** A skill returns a
   recommendation; the orchestrator decides whether to apply it.
   Mutating the Sentinel system goes through walker functions only,
   gated by `--apply`.
5. **Skills are testable in isolation.** Each one takes structured
   input and returns structured output, which means we can fixture
   them for regression tests.

---

## Open skill questions

- Should `flag_leakage` get a "test predictions on a future-dated split"
  capability? More expensive, more correct.
- Should we add a `cross_validate_model` skill that runs k-fold
  outside the main training loop? Or trust the platform's holdout?
- Do we need a `recommend_retraining_window` skill given seasonality
  in credit data?
- Should `disparate_impact_check` be replaced by a vendor product
  (Aequitas, fairlearn) or built in-house? Probably wrap a vendor.
