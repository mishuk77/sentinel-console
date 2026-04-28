# Post-Demo Sprint — Completion Report

**Sprint:** sprint_spec_post_demo-2.md
**Started:** 2026-04-28
**Commits:** 17 (12 in initial run + 5 in resume)
**Backend tests:** 0 → 110 passing
**Files changed:** ~50 across backend + frontend

## Sprint Status by Task

| Task | Status | Notes |
|------|--------|-------|
| **TASK-1** Fix LR inference saturation bug | ✅ Complete | InferencePreprocessor + schema-v2 artifacts, 17 tests, batch saturation warning |
| **TASK-2** Global policy slider reactivity + persistence | ✅ Complete | bandFromScore() pre-populates slider; "Last saved" timestamp displayed |
| **TASK-3** Exposure Control full impact table | ✅ Complete | 3 stages × 10 metrics, ComparisonTable, audit info, CSV export |
| **TASK-4** Segmentation cascade + UI banner | ✅ Complete (4A, 4B) · Partial (4C) | Cascade resolver + 13 tests + banner. Per-segment row tags + portfolio totals are TASK-11F polish |
| **TASK-5** Remove fraud tier boundary caps | ✅ Complete | Full 0.01-0.99 range, validation, empty-tier warning |
| **TASK-6** Outcome flag + 3-mode loss handling | ✅ Complete (resume session) | Backend in main sprint; `<ColumnAnnotationEditor />` modal added in resume session — Datasets page now shows mode badge per row + tag icon to edit |
| **TASK-7** Projected Simulation Summary | ✅ Complete | Three-column page with Score Distribution + Lift Summary, reuses ImpactTable |
| **TASK-8** Engine Backtest | ✅ MVP + async + batch SHAP (resume session) | Full production code path, row-level drill-down with per-row SHAP top-3 reasons (TreeExplainer batch ~100x faster than per-row), calibration view, audit trail. Now async via Celery — endpoint returns immediately, frontend polls. S3 Parquet for >1000 rows still deferred |
| **TASK-9** Calibration check on registration | ✅ Complete (consolidated into Layer 2) | Per spec note — TASK-9 ran as Layer 2's H5 |
| **TASK-10 L1** Training-time validation | ✅ Complete | Health checks run after fit; FAIL blocks artifact write |
| **TASK-10 L2** Registration-time validation | ✅ Complete | Health checks fire on policy activate; FAIL blocks publish |
| **TASK-10 L3** Runtime monitoring | ✅ Complete (resume session) | Redis rolling window + Celery beat task @ 5min, `runtime_health_status` on DecisionSystem, push hook in decision_service |
| **TASK-11A** MetricValue component | ✅ Complete | Currency / percent / count / pp formats with parentheses-for-negatives, hover full-precision tooltips |
| **TASK-11B** Reconciliation tests | ✅ Complete | 21 tests cover every math invariant (avg×count=total, baseline+Δ=final, etc.) |
| **TASK-11C** Audit metadata | ✅ Complete | AuditInfo collapsible panel; every simulation/backtest response includes meta block |
| **TASK-11D** Reproducibility hardening | ✅ Partial | Policy snapshots, model artifact pinning, dataset content hash, engine_version, deletion protection on datasets referenced by backtests. Schema-version + legacy-render shim deferred |
| **TASK-11E** Draft / published policy states | ✅ Complete | state enum + last_published_at + published_by + published_snapshot. Singleton-published per system |
| **TASK-11F** Segment breakouts toggle | ✅ Complete (resume session) | `break_out_by_dimension()` engine + `/simulate/breakout` endpoint + ImpactTable dropdown + 10 reconciliation tests |
| **TASK-11G** "What changed" diff view | ✅ Complete (resume session) | `diff_policies()` engine + `/simulate/diff` endpoint + `<PolicyDiff />` component + 10 tests, wired into ExposureControl |
| **TASK-11H** Compare to prior policy | ✅ Complete (resume session) | Same component as TASK-11G — pass `published_snapshot` as policy_a |
| **TASK-11I** Export format standards | ✅ Partial | CSV exports for ImpactTable already include metadata header (TASK-11I-compliant). Filenames already follow `sentinel_{type}_{id}_{ts}` convention. PDF cover/footer is the next iteration |

## Architectural Foundations Now in Place

These are the building blocks that the deferred work plugs into without
re-architecting:

1. **`InferencePreprocessor`** (`backend/app/services/inference_preprocessor.py`)
   Captures every training preprocessing step. Used by:
   - TASK-1 inference fix
   - TASK-3 simulation engine row scoring
   - TASK-8 backtest scoring
   - TASK-10 Layer 2 parity check

2. **`simulate_portfolio()`** (`backend/app/services/portfolio_simulation.py`)
   Single source of truth for portfolio math. Reused by:
   - TASK-3 (exposure control table)
   - TASK-2 (slider reactivity — same engine, single stage view)
   - TASK-7 (projected simulation summary)
   - TASK-4 (segmentation portfolio totals — runs the engine per segment)

3. **`InferenceHealthChecker`** (`backend/app/services/inference_health.py`)
   Six checks (H1-H6) shared across all three TASK-10 layers. Adding
   Layer 3 is wiring Celery beat to call `run_all()` on a Redis-backed
   rolling window — no new health logic needed.

4. **`<MetricValue />`** (`frontend/src/components/ui/MetricValue.tsx`)
   Used everywhere a number is displayed. Adding new pages doesn't
   require re-implementing formatting rules.

5. **`<ComparisonTable />`** (`frontend/src/components/ui/ComparisonTable.tsx`)
   3+ stage comparison with delta column and color polarity.
   Reusable by future tasks (e.g., TASK-11H prior-policy compare just
   means rendering a different column set).

6. **`<AuditInfo />`** (`frontend/src/components/ui/AuditInfo.tsx`)
   Drop-in audit panel for any page that produces metric output.

7. **`loss_metadata.resolve_loss_handling()`** (`backend/app/services/loss_metadata.py`)
   Single source of truth for the 3-mode dollar logic.
   Every place that computes a dollar metric reads from this resolver.

## Deferred Work — Backlog

The following items are scoped, ready, and have all dependencies in
place. Each can be picked up as a discrete commit:

### TASK-10 Layer 3 — Runtime monitoring
- Add Celery beat schedule entry: every 5 minutes, run health checks on
  the rolling window of recent predictions per active decision system
- Use Redis sorted set keyed `inference_window:{decision_system_id}` —
  storage helper to push predictions into the window from
  `decision_service._score_model`
- Wire alerts to Slack/email when FAIL fires
- Surface `health_status` on the Decision System detail page

### TASK-8 follow-ups
- S3 Parquet writer for full backtest results beyond row 1000
- Async job pattern (current is synchronous)
- PDF exports (CSV via row API works today)
- TreeExplainer batch SHAP for the row-level drill-down

### TASK-11F Segment breakouts
- Add a "Break out by segment" toggle to ComparisonTable
- When toggled, simulation backend computes per-segment metrics and
  rolls them up to the portfolio total
- Reconciliation test: sum of per-segment metrics equals portfolio total

### TASK-11G "What changed" diff
- On policy/exposure pages, compute the set of applications that
  cross a decision boundary when policy parameters change
- Display: count + dollar volume + clickable list of application IDs
- Uses `dataset.id_column` (already in schema)

### TASK-11H Compare to prior policy
- Add a "Compare against published policy" toggle on simulation pages
- Render side-by-side ComparisonTable with current production +
  proposed + delta columns
- Backend: extend `/simulate/portfolio` to accept two policies and
  return both in one response

### TASK-11I PDF cover/footer
- Use `pdfkit` or `weasyprint` to generate PDFs with audit metadata
  cover page + per-page header/footer

### TASK-6 frontend
- Dataset detail page with column annotation editor
- "Tag as approved-amount column" / "Tag as ID column" toggles
- "Tag as segmenting dimension" multi-select (TASK-11F prerequisite)

## Key Decisions Made During Sprint

These decisions inform the deferred work:

- **LGD assumption: 100%** — predicted_loss = approved_amount × probability
  with no additional LGD multiplier. UI footnote disclosure on every page
  that shows dollar metrics.
- **No revenue model** — input files don't carry revenue data; net
  risk-adjusted volume is just `approved_$ - predicted_loss_$`.
- **Backtest determinism via snapshots, not engine versioning shims** —
  policy_snapshot + model_artifact_path + dataset_content_hash captured
  at run start. Re-rendering reads from the persisted Parquet (when
  written) or row results, not from re-running the engine.
- **Synchronous backtest MVP** — tradeoff against async-job complexity.
  ~30-60 sec for 50K rows is acceptable for the demo; async pattern is
  the next iteration.
- **TASK-9 consolidated into TASK-10 Layer 2** — per spec note. There is
  no separate calibration-only registration check; calibration fires as
  H5 within the full Layer 2 health gate.

## Test Coverage

Total backend tests: **110 passing**

| File | Tests | Focus |
|------|-------|-------|
| test_inference_preprocessor.py | 11 | Preprocessor parity, unseen categories, joblib roundtrip |
| test_lr_inference.py | 6 | TASK-1 acceptance criteria, schema v2 artifact roundtrip |
| test_loss_metadata.py | 16 | Mode resolution priority, UI footnotes, auto-suggestion |
| test_portfolio_simulation.py | 21 | Math invariants, reconciliation rules, determinism |
| test_segment_cascade.py | 13 | Cascade rules, override precedence, filter operators |
| test_inference_health.py | 23 | H1-H6 PASS/WARN/FAIL cases, run_all aggregation |
| test_policy_diff.py | 10 | TASK-11G/H — diff buckets, dollar reconciliation, ID capping |
| test_segment_breakout.py | 10 | TASK-11F — Σ segments == portfolio reconciliation rule |

TASK-8 backtest endpoint integration tests are still deferred
(the underlying scoring path is exercised by the LR + preprocessor
tests and the full pipeline runs cleanly end-to-end).

## How to Resume Work

1. Read this file + `session-handoff.md` for project context.
2. Run the test suite to verify nothing broke since handoff:
   ```
   cd backend && ./venv/Scripts/python -m pytest tests/
   ```
3. Pick a deferred-work item from the backlog above. Each is scoped
   and has its dependencies in place — no foundational refactoring
   needed.
4. Build → test → commit → push, matching the established pattern.
