# Sentinel QA — Comprehensive Demo Path Walker

Walks every functional area of the platform via the same HTTP contract the
frontend uses, asserts on each step, and writes a markdown report grouped by
severity. ~40+ endpoints across all modules.

What this catches: backend regressions, missing data, broken state
transitions, gateway-timeout-prone routes, response-shape changes the
frontend depends on, the architectural invariants we've already had to fix
once (segment persistence across policy edits, save round-trip
verification, etc.).

What this does **not** catch: pure UI bugs (cache invalidation, stale state,
broken empty-state) — those need a browser harness.

## Setup

```bash
cd sentinel-qa
python -m venv .venv
.venv/Scripts/activate         # Windows
# source .venv/bin/activate    # macOS/Linux
pip install -r requirements.txt
```

## Run

### Read-only sweep (safe — no mutations)

```bash
SENTINEL_API_URL=https://your-railway.up.railway.app/api/v1 \
SENTINEL_PASSWORD='...' \
python walker.py
```

### Full sweep including mutating endpoints

Use this to verify the full demo flow, including publishing a policy,
calibrating segments, and making a decision. Will **alter durable state**
on the target environment (creates a new published policy revision,
calibrates segments, creates a decision record).

```bash
python walker.py --include-mutations
```

### Single module

```bash
python walker.py --module fraud
python walker.py --module policies --include-mutations
python walker.py --modules systems,datasets,models
```

### Inventory

```bash
python walker.py --list-steps
```

## Coverage by module

| Module | Steps | What's exercised |
|---|---|---|
| **auth** | health, login | API reachability, OAuth2 password flow |
| **systems** | list, get | Decision-system list, response-shape required by frontend (active_policy_summary etc.) |
| **datasets** | list, preview, profile, segment-columns | Dataset listing + preview; flags missing annotations |
| **models** | list, get, risk-amount-matrix, documentation | Risk model selection, feature_stats, calibration data, docx export |
| **policies** | list, publish, recommend-amounts | Policy listing (asserts singleton-active invariant), atomic publish + round-trip threshold verification |
| **segments** | list, calibrate, calibration, impact | Segment CRUD readback, bulk calibrate, per-segment calibration, 3-stage impact panel sanity checks |
| **simulation** | portfolio, breakout, diff | The endpoints backing ImpactTable / ExposureControl / PolicyDiff |
| **decisions** | list, stats, make, get | Decision history, overview stats, single decision through prod engine, audit lookup |
| **backtest** | list, get, rows | Backtest history; flags inaccessible runs |
| **dashboard** | stats, volume, deployment, daily | Top-level dashboard tiles |
| **fraud** | settings, tiers, models, models.features, rules, rules.fields, cases, signals.providers, analytics × 5 | Full fraud module sweep (read-only) |
| **lifecycle** | segment_persistence | Composite invariant: segments survive policy republishing |

## Severity levels

- **P0** — demo-blocking. Walker exits with status 1.
- **P1** — likely to surface during demo (slow latency, missing fields, etc.).
- **P2** — edge case / configuration.
- **INFO** — observation, not a failure (e.g. "no fraud module configured").

## Latency budget

Every HTTP call is timed. A successful response that takes:
- < 15s — passes silently
- 15–28s — flagged P1 (slow)
- > 28s — flagged P0 (close to Railway's gateway timeout window)

This catches "works fine on dev, times out on Railway with a real dataset"
*before* the demo audience sees Network Error.

## What this asserts that's worth knowing

1. **Single source of truth on threshold** — `policies.publish` posts a
   threshold, then re-fetches `/systems/{id}` and asserts the persisted
   threshold matches within `1e-6`. Catches the silent-failure mode where
   activate succeeded but the active pointer didn't update.
2. **Singleton active policy** — `policies.list` flags if more than one
   policy has `is_active=True` for the same system.
3. **Segment persistence across publishes** — `lifecycle.segment_persistence`
   re-publishes the policy at the same threshold and asserts the segment
   count is unchanged. Catches the "segments disappear after global edit"
   regression we already had to fix once.
4. **Reconciliation on the impact panel** — `segments.impact` asserts the
   three stages all use the same population size (`n_total`) and that
   baseline approval = 100%.
5. **Population shape on simulation** — `simulate.portfolio` checks the
   meta block exists for audit traceability.

## Outputs

- `stdout` — color-coded module-grouped pass/fail, one line per step
- `issues.md` — markdown report grouped by severity (regenerated each run)
- `walker.log` — verbose execution log

Exit code: `1` if any P0 finding, `0` otherwise. Useful in CI.

## Mutating vs read-only endpoints

Mutating steps are gated behind `--include-mutations`. They are:

- `policies.publish` — creates a new published policy revision
- `segments.calibrate` — runs Phase 1 sample-counting + Phase 2 scoring
- `decisions.make` — writes a single decision record
- `lifecycle.segment_persistence` — runs an extra publish to verify the
  invariant

**Destructive** endpoints (delete model, delete dataset, delete policy,
delete fraud rule) are NEVER exercised by the walker. Test those manually
when you intend to delete something.

## Adding a step

Edit `walker.py`:

1. Add a `step_*(state: State) -> bool` function. Use:
   - `_call(state, method, path, ...)` for HTTP — handles timing + error capture
   - `_record(state, Finding(severity, step, message, detail))` for findings
   - `_ok(state, step, message, duration)` for success
   - `_info(state, step, message)` for non-failure observations
2. Append to `ALL_STEPS` with `(label, fn, halt_on_failure, module_name)`
3. Test with `python walker.py --module <module_name>`
