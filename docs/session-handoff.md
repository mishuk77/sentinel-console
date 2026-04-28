# Sentinel Console — Session Handoff Document

**Created:** 2026-04-09
**Last updated:** 2026-04-28 (post-demo sprint)
**Purpose:** Complete project context for continuing development in a new Claude Code session on another machine. Read this file at the start of a new conversation to restore full context.

## Post-Demo Sprint Status (2026-04-28)

A multi-week post-demo iteration sprint was executed across 12+ commits.
See `docs/sprint-completion.md` for full task-by-task status and the
deferred-work backlog. Headline:

  - **103 backend tests passing** (was 0 — full pytest infrastructure built)
  - LR inference saturation bug fixed at root cause (TASK-1)
  - Deterministic portfolio simulation engine with reconciliation tests (TASK-3, TASK-11B)
  - Three-stage Exposure Control table with audit metadata + CSV export
  - Engine Backtest MVP — production code path, row-level drill-down (TASK-8)
  - Three-layer health guardrail framework with H1-H6 checks (TASK-9, TASK-10 L1+L2)
  - Outcome flag and 3-mode loss handling refactor (TASK-6)
  - Cross-cutting MetricValue, ComparisonTable, AuditInfo components (TASK-11A/C)
  - Draft / published policy state machine (TASK-11E)
  - Deletion protection on datasets referenced by backtests (TASK-11D)

---

## 1. What Is Sentinel Console?

Sentinel Console is a **credit risk and fraud detection platform** built as a full-stack web application. It allows financial institutions to:

- Upload historical loan/transaction data (CSV)
- Train ML models (Logistic Regression, Random Forest, XGBoost, LightGBM, Stacked Ensemble)
- Configure approval policies with score cutoffs and exposure limits
- Run real-time inference (scoring + decisioning) via API
- Manage fraud detection with tiered risk assessment

Think of it as a self-hosted, Palantir-style decisioning OS for fintech/lending.

---

## 2. Project Structure

```
c:\Dev\sentinel-console\
├── frontend\                     # Vite + React + TypeScript + Tailwind
│   ├── src\
│   │   ├── components\
│   │   │   ├── training\TrainingPage.tsx   # Shared training UI (credit + fraud)
│   │   │   ├── layout\TopNav.tsx
│   │   │   ├── layout\Sidebar.tsx
│   │   │   ├── layout\Layout.tsx
│   │   │   ├── ui\Breadcrumbs.tsx
│   │   │   ├── CreateSystemWizard.tsx
│   │   │   └── ModuleGuard.tsx
│   │   ├── pages\                # ~28 page components
│   │   │   ├── Dashboard.tsx
│   │   │   ├── Datasets.tsx
│   │   │   ├── Models.tsx
│   │   │   ├── ModelDetail.tsx
│   │   │   ├── Policy.tsx
│   │   │   ├── ExposureControl.tsx
│   │   │   ├── Decisions.tsx
│   │   │   ├── FraudDashboard.tsx  # + 10 more Fraud* pages
│   │   │   ├── Login.tsx
│   │   │   ├── SystemLayout.tsx    # System-level layout + side nav
│   │   │   └── ...
│   │   ├── lib\
│   │   │   ├── api.ts              # Axios instance + types
│   │   │   ├── ThemeContext.tsx     # Dark mode default
│   │   │   └── utils.ts
│   │   └── index.css               # Design system (component layer)
│   └── package.json
│
├── backend\                      # FastAPI + SQLAlchemy + Celery
│   ├── app\
│   │   ├── main.py               # FastAPI app entry point
│   │   ├── celery_app.py         # Celery configuration
│   │   ├── tasks.py              # Celery training task
│   │   ├── core\
│   │   │   ├── config.py         # Pydantic Settings (env vars)
│   │   │   └── security.py       # JWT auth
│   │   ├── api\
│   │   │   ├── router.py         # Route aggregation
│   │   │   ├── deps.py           # Auth dependencies
│   │   │   └── routes\
│   │   │       ├── auth.py
│   │   │       ├── datasets.py   # Upload, download, preview, profile
│   │   │       ├── models.py     # Training, events, model CRUD
│   │   │       ├── decision.py   # Real-time inference API
│   │   │       ├── policies.py   # Policy CRUD + activation
│   │   │       ├── policy_segments.py  # Segmented policy rules
│   │   │       ├── fraud.py
│   │   │       ├── dashboard.py
│   │   │       └── systems.py
│   │   ├── models\               # SQLAlchemy ORM models
│   │   │   ├── ml_model.py       # MLModel (status: TRAINING/CANDIDATE/ACTIVE/FAILED)
│   │   │   ├── dataset.py
│   │   │   ├── policy.py
│   │   │   ├── decision.py
│   │   │   ├── decision_system.py
│   │   │   ├── exposure_limit.py
│   │   │   ├── fraud.py
│   │   │   ├── policy_segment.py
│   │   │   ├── user.py
│   │   │   └── client.py
│   │   ├── services\
│   │   │   ├── training.py       # ML training pipeline (THE core file)
│   │   │   ├── decision_service.py  # Inference + SHAP explanations
│   │   │   ├── storage.py        # S3/local storage abstraction
│   │   │   ├── loan_amount.py    # Exposure control ladder logic
│   │   │   ├── fraud_service.py
│   │   │   └── documentation.py
│   │   └── db\
│   │       ├── session.py        # SQLAlchemy session factory
│   │       └── base.py
│   ├── Dockerfile
│   ├── railway.toml
│   ├── requirements.txt
│   └── alembic\                  # Database migrations
│
└── docs\
    ├── aws-migration-plan.md     # Detailed AWS migration plan
    └── session-handoff.md        # This file
```

**IMPORTANT:** `c:\Dev\sentinel-api\` is an **ABANDONED** standalone project. Never make changes there. All backend work goes in `sentinel-console\backend\`.

---

## 3. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Vite + React 18 + TypeScript + Tailwind CSS |
| Charts | Recharts |
| State | TanStack Query (React Query) |
| Routing | React Router v6 |
| Backend | FastAPI (Python 3.11) |
| ORM | SQLAlchemy |
| Auth | JWT (python-jose) |
| ML | scikit-learn, XGBoost, LightGBM, joblib |
| Task Queue | Celery + Redis |
| Database | PostgreSQL |
| Storage | S3 (Railway expandable-vault, S3-compatible) |
| Frontend Hosting | Vercel |
| Backend Hosting | Railway (2 services: API + Worker) |

---

## 4. Deployment Architecture

```
Vercel (frontend)
  └─ VITE_API_URL → Railway API

Railway:
  ├── sentinel-api
  │     Start: uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
  │     Env: ENV=production, STORAGE_TYPE=s3, CELERY_WORKER unset
  │
  ├── sentinel-worker
  │     Start: celery -A app.celery_app:celery_app worker --loglevel=info --concurrency=1 --pool=prefork
  │     Env: ENV=production, STORAGE_TYPE=s3, CELERY_WORKER=1
  │
  ├── Redis (managed)
  │     Used for: Celery broker + training event store (EventStore)
  │
  ├── PostgreSQL (managed)
  │     Used for: All application data
  │
  └── expandable-vault (S3-compatible)
        Endpoint: https://t3.storageapi.dev
        Used for: Pickled model artifacts (.pkl), uploaded CSV datasets
```

**Critical deployment notes:**
- Railway dashboard variables **override** `railway.toml` `[env]` values. Always set `STORAGE_TYPE=s3` in the dashboard for both services.
- Both services use the same Dockerfile but different start commands (set per-service in Railway dashboard, NOT in railway.toml).
- `.env` is in `.dockerignore` — never baked into the Docker image.

---

## 5. How ML Training Works

### Pipeline Flow (in `backend/app/services/training.py`)

1. **Data Loading** — Download CSV from S3, validate target/feature columns
2. **Data Profiling** — Numeric/categorical detection, missing %, class balance
3. **Class Imbalance** — If minority < 15%, apply balanced class weights
4. **Feature Engineering:**
   - Drop high-cardinality categoricals (>50 unique)
   - Bayesian target encoding with smoothing
   - Winsorization at 1st/99th percentile
   - Median imputation for missing values
   - One-hot encoding for remaining categoricals
5. **Scaling** — StandardScaler (critical for Logistic Regression)
6. **Sampling Cap** — Stratified downsample to 150K rows if larger
7. **Train/Test Split** — 80/20 stratified
8. **Hyperparameter Tuning** — RandomizedSearchCV per model:
   - Logistic Regression: 10 configs
   - Random Forest: 12 configs
   - XGBoost: 15 configs
   - LightGBM: 15 configs
   - All use 3-fold stratified CV
9. **Ensemble** — Champion-boosted probability blend of top 4 models
10. **Evaluation** — Holdout AUC, overfitting check, SHAP feature importance

### Model Storage

Models are serialized with `joblib.dump()` as dicts:
```python
{"model": clf, "scaler": scaler, "columns": list(X.columns)}
```
Uploaded to S3 as `models/{algorithm}_{version_id}.pkl`.

Ensembles store metadata:
```python
{"type": "champion_boosted_blend", "components": [...], "weights": [...]}
```

### Inference (in `backend/app/services/decision_service.py`)

1. `_load_model()` — Downloads `.pkl` from S3, deserializes with `joblib.load()`, caches in memory
2. `_score_model()` — Handles 3 artifact types:
   - Raw sklearn model → `predict_proba(df)[0][1]`
   - Dict wrapper `{model, scaler, columns}` → reindex features, apply scaler, predict
   - Ensemble meta → recursively score components, weighted average
3. `make_decision()` — Score → compare against policy threshold → APPROVE/DECLINE → SHAP adverse action reasons → exposure control (loan amount ladder)

### Training Events

The training pipeline emits granular events via `training_service.emit()` stored in Redis (EventStore). The frontend polls `/models/training-events/{jobId}` every 1s during training. Events include:
- Worker dispatch info
- Data profiling stats
- Per-step feature engineering details
- Per-model: search space, timing, best hyperparameters, holdout vs CV comparison
- Overfitting analysis per model
- Artifact serialization with file size
- Final leaderboard ranking

Events persist in the frontend via `sessionStorage` so the pipeline log survives page navigation.

### Training Constraints on Railway

- `n_jobs=1` forced in production (prefork pool + loky = can't parallelize)
- `OPENBLAS_NUM_THREADS=1`, `MKL_NUM_THREADS=1`, `OMP_NUM_THREADS=1` set in `celery_app.py`
- `worker_max_tasks_per_child=1` to prevent memory leaks
- Solo pool was tried and failed (can't spawn subprocesses on Railway)
- 6K rows trains in ~2-3 minutes, 30K rows untested but expected ~10-15 min

---

## 6. Design System

Dark mode by default. All styles in `frontend/src/index.css` component layer:

| Class | Purpose |
|-------|---------|
| `.page` | Page wrapper: `p-6 max-w-screen-xl mx-auto space-y-5` |
| `.panel` | Card: `bg-card border rounded overflow-hidden` |
| `.panel-head` | Card header with border-bottom |
| `.panel-title` | `text-sm font-semibold` |
| `.kpi` / `.kpi-value` / `.kpi-label` | Stat cards |
| `.dt` / `.dt-hover` | Data tables |
| `.badge-green/red/amber/blue/muted` | Status badges |
| `.btn-primary/ghost/outline/danger` | Buttons with size variants `btn-sm/xs` |
| `.field-input` / `.field-label` | Form elements |
| `.icon-box` / `.icon-box-sm` | Icon containers |
| `text-up` / `text-down` / `text-warn` / `text-info` | Semantic colors (green/red/amber/blue) |

**Rules:**
- NO hardcoded `bg-green-*`, `bg-red-*`, `text-gray-*` — use semantic classes
- Charts use `hsl(var(--border))`, `hsl(var(--muted-foreground))`, `hsl(var(--popover))`
- Chart colors: CHART_BLUE, CHART_GREEN, CHART_RED, CHART_PURPLE (defined as HSL constants)

---

## 7. Recent Work (April 2026 Sessions)

### Celery + Redis Worker Architecture
- Moved ML training from in-process (crashed Railway containers due to thread/fork issues) to Celery worker
- Debugged: `AttributeError: _events` (stale reference), `FileNotFoundError` on local storage (needed S3), STORAGE_TYPE overrides, solo pool failures
- Final working config: prefork pool, n_jobs=1, thread caps, S3 shared storage

### Training UI Enhancements
- State machine: IDLE → STARTING → TRAINING → COMPLETED/FAILED
- Live pipeline feed with granular events from backend
- FAILED state with red styling, persistent error log
- Pipeline log: always visible during training, collapsible after completion
- Events persisted in sessionStorage across page navigation

### Six UI Improvements (latest batch)
1. **Datasets** — Download button for uploaded datasets (new backend endpoint + blob download)
2. **Training** — Pipeline log persistence via sessionStorage
3. **Models** — AUC orange threshold lowered from 80% to 75%
4. **Model Detail** — "Risk by Decile" renamed to "Observed Bad Rate by Score Bin"
5. **Policy** — Collapsible instructions panel with PAV isotonic smoothing explanation
6. **Exposure Control** — Impact Simulation panel moved to right column

### Hyperparameter Tuning Speedup
- Reduced search configs: LogReg 20→10, RF 25→12, XGB 30→15, LGB 30→15
- CV was already 3 folds (no change needed)
- Total fits: 156 (was 315) — roughly halved training time

---

## 8. Known Issues & Gotchas

1. **Railway outages** — Platform-level outages have disrupted demos. AWS migration planned for June/July 2026 (see `docs/aws-migration-plan.md`).

2. **Redis DNS resolution** — Transient `redis.railway.internal` DNS failures on Railway. If training events don't appear, check Railway Redis service health.

3. **Model cache resets on deploy** — `DecisionService._model_cache` is in-process memory. Every API redeploy clears it; first inference after deploy downloads the model from S3 (slow).

4. **n_jobs=1 on Railway** — Despite 32 vCPU plan, sklearn can't parallelize inside Celery prefork workers. Training is single-threaded. This is a Railway/container limitation, not a code bug.

5. **Loky warning spam** — `Loky-backed parallel loops cannot be called in a multiprocessing` warnings flood worker logs. Harmless but noisy. Would be fixed by moving to AWS with proper process isolation.

6. **Frontend bundle size** — 1MB+ JS bundle. Needs code splitting with dynamic imports eventually.

7. **Policy page light-mode colors** — The step indicator in Policy.tsx uses `from-blue-50 to-indigo-50 border-blue-200` which doesn't follow the dark-mode design system. Needs updating.

---

## 9. Environment Setup (New Machine)

### Prerequisites
- Python 3.11
- Node.js 18+
- Git

### Backend
```bash
cd sentinel-console/backend
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Create .env with:
# DATABASE_URL=postgresql://...
# SECRET_KEY=...
# REDIS_URL=redis://localhost:6379/0  (for local Celery)
# STORAGE_TYPE=local  (or s3 with AWS vars)

uvicorn app.main:app --reload
```

### Frontend
```bash
cd sentinel-console/frontend
npm install
npm run dev
```

### Local Celery (optional)
```powershell
$env:CELERY_WORKER="1"; celery -A app.celery_app:celery_app worker --loglevel=info --concurrency=1 --pool=prefork
```
Note: Use PowerShell syntax (`$env:VAR="val";`), not bash (`export VAR=val &&`).

### Build
```bash
cd frontend && npm run build    # TypeScript check + Vite build
```

---

## 10. Key API Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/v1/auth/login` | JWT login |
| GET | `/api/v1/datasets/` | List datasets |
| POST | `/api/v1/datasets/upload` | Upload CSV |
| GET | `/api/v1/datasets/{id}/download` | Download CSV |
| GET | `/api/v1/datasets/{id}/preview` | First 5 rows |
| GET | `/api/v1/datasets/{id}/profile` | Data quality profile |
| POST | `/api/v1/models/{dataset_id}/train` | Start training (dispatches Celery task) |
| GET | `/api/v1/models/training-events/{job_id}` | Poll pipeline events |
| GET | `/api/v1/models/` | List models |
| POST | `/api/v1/decide` | Real-time inference |
| POST | `/api/v1/policies/` | Create/update policy |
| POST | `/api/v1/policies/{id}/activate` | Activate policy |

---

## 11. Database Schema (Key Tables)

| Table | Key Columns | Notes |
|-------|-------------|-------|
| `users` | id, email, client_id, hashed_password | Multi-tenant via client_id |
| `clients` | id, name | Tenant isolation |
| `decision_systems` | id, name, client_id, system_type | "credit", "fraud", or "full" |
| `datasets` | id, decision_system_id, s3_key, status, metadata_info | PENDING/VALID/INVALID/FAILED |
| `ml_models` | id, dataset_id, decision_system_id, algorithm, status, metrics, artifact_path | TRAINING/CANDIDATE/ACTIVE/FAILED |
| `policies` | id, decision_system_id, model_id, threshold, is_active, amount_ladder | One active per system |
| `policy_segments` | id, policy_id, segment_key, segment_value, cutoff | Per-segment overrides |
| `decisions` | id, decision_system_id, score, decision, input_data, created_at | Audit log of all decisions |
| `exposure_limits` | id, decision_system_id, limits_config | Amount ladder per risk bin |
| `fraud_tier_configs` | id, decision_system_id, low_max, medium_max, high_max, dispositions | Fraud tier thresholds |

---

## 12. Pending / Future Work

- **AWS migration** — Planned for June/July 2026. Full plan in `docs/aws-migration-plan.md`. Use Flightcontrol (Railway-like UX on AWS). Only code change: IAM role fallback in `storage.py`.
- **Training with larger datasets** — 30K+ rows untested on Railway. May need memory/time adjustments.
- **Diagnostic events cleanup** — `worker_dispatch`, `worker_env` events in `tasks.py` can be removed once production is stable.
- **Frontend code splitting** — Bundle is 1MB+, needs dynamic imports.
- **Policy page dark mode** — Step indicator uses light-mode Tailwind colors.

---

## 13. User Preferences & Working Style

- Prefers concise, direct communication — no fluff
- Wants demo-ready UI with impressive detail (e.g., rich pipeline feed for data scientists)
- Works across multiple machines — needs portable context
- Uses PowerShell on Windows (not bash)
- Active Railway Pro plan with 32 vCPU / 32 GB RAM
- Git remote: `github.com/mishuk77/sentinel-console` on `main` branch
- Vercel for frontend, Railway for backend
- Prefers to test on Railway (production) rather than local when possible
