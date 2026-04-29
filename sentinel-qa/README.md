# Sentinel QA — Demo Path Walker

A Python script that walks the full demo flow against a deployed Sentinel
backend, asserts on each step, and writes a markdown report of failures.

The walker hits the same HTTP endpoints the frontend uses, so any backend
breakage on the demo path surfaces here before the demo audience sees it.
What it does **not** catch: pure UI bugs (cache invalidation, stale state,
broken empty-state) — those need a browser harness.

## Setup

```bash
cd sentinel-qa
python -m venv .venv
.venv/Scripts/activate     # Windows
# source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

## Run against Railway (production)

```bash
SENTINEL_API_URL=https://your-railway-backend.up.railway.app/api/v1 \
SENTINEL_EMAIL=mishuk77@gmail.com \
SENTINEL_PASSWORD='...' \
python walker.py
```

Or pass flags directly:

```bash
python walker.py \
    --base-url https://your-railway-backend.up.railway.app/api/v1 \
    --password '...'
```

## Run against local dev

```bash
# In one terminal: backend
cd ../backend && uvicorn app.main:app --reload

# In another terminal:
cd sentinel-qa
SENTINEL_PASSWORD='...' python walker.py
```

Defaults to `http://localhost:8000/api/v1`.

## Output

- **stdout** — color-coded pass/fail summary, one line per step
- **issues.md** — markdown report grouped by severity (regenerated each run)
- **walker.log** — full log of every line emitted (useful for grepping)

The script exits with status `1` if any P0 findings were recorded, `0` otherwise.

## What gets exercised

The walker assumes you already have a system + dataset + model in the database
(creating those is slow and not idempotent). Each run:

1. **health** — API reachability smoke test
2. **login** — OAuth2 password flow, captures access token
3. **pick system** — chooses an existing decision system (prefers one with an active model)
4. **get system detail** — verifies response shape used by the frontend
5. **pick dataset** — checks dataset annotations (approved_amount_column, segmenting_dimensions)
6. **list models** — picks the active or highest-AUC candidate; flags missing artifact_path
7. **publish policy** — `POST /policies/publish` with full round-trip verification
   (re-fetches `/systems/{id}` and asserts persisted threshold matches)
8. **list segments** — counts segments on the active policy
9. **calibrate segments** — runs the bulk calibrate route; flags if `n_samples` aren't populated after
10. **segmentation impact** — fetches the 3-stage impact comparison and runs sanity checks
    (baseline approval = 100%, segmented stage uses same population as global)
11. **simulate portfolio** — exercises the simulation endpoint that backs ImpactTable
12. **make decision** — single decision through the production engine
13. **backtest runs list** — checks the backtest history endpoint

Every step is timed. Latency over **15s** flags P1 (slow), over **28s** flags P0
(near Railway's gateway timeout).

## Severity levels

- **P0** — demo-blocking. Halt the walker on a P0 in a required step.
- **P1** — likely to surface during demo. Visible silently-degraded experience.
- **P2** — edge case / configuration issue.
- **INFO** — observation, not a failure (e.g. "no segments configured yet").

## Adding a step

1. Add a `step_*` function in `walker.py` that takes `state: State` and returns `bool`
2. Use `_call(state, "GET"|"POST"|..., path, step="...")` for HTTP — handles timing,
   error capture, and the gateway-timeout warning automatically
3. Use `_record(state, Finding(severity, step, message, detail))` for assertions
4. Use `_ok(state, step, message, duration)` for successful step completion
5. Append to the `DEMO_STEPS` list with `(label, fn, halt_on_failure)`

## What this does NOT cover

- Frontend cache invalidation bugs ("save succeeded but UI shows old value")
- Component-state regressions ("slider rehydrates to wrong position on reload")
- CSS / layout / accessibility
- Cross-browser compatibility
- The full training pipeline (slow; assumes models pre-exist)
- Dataset upload (slow; assumes datasets pre-exist)

For those, run the demo flow manually in a browser at least once before the
demo. Use the build-indicator timestamp in the top nav to confirm you're
testing the latest deploy.
