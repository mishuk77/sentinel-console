# Sentinel Console — AWS Migration Plan

**Author:** Claude (AI-assisted planning)
**Created:** 2026-04-07
**Target Timeline:** ~2 months from now (June/July 2026)
**Current Platform:** Railway (API + Worker + Redis + Postgres + S3-compatible vault)
**Target Platform:** AWS via Flightcontrol (ECS Fargate + RDS Aurora + ElastiCache + S3)

---

## 1. Executive Summary

Sentinel Console's ML training and inference platform currently runs on Railway. While Railway provides excellent DX, it has experienced platform-level outages that have disrupted live demos. This plan migrates all backend infrastructure to AWS (via Flightcontrol for Railway-like UX) while keeping the frontend on Vercel.

**Key decisions:**
- **Flightcontrol** over raw AWS — preserves the visual dashboard and push-to-deploy workflow
- **ECS Fargate** over EC2/Lambda — containerized, auto-scaling, no server management
- **No SageMaker** — current joblib + predict_proba inference is faster and cheaper at our scale
- **Keep Vercel** for frontend — only the API URL changes

---

## 2. Current Architecture

```
┌─────────────────────────────────────────────────────────┐
│  Vercel (Frontend)                                      │
│  - Vite + React + TypeScript                            │
│  - VITE_API_URL → Railway API                           │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│  Railway                                                │
│                                                         │
│  ┌──────────────┐   ┌──────────────┐   ┌────────────┐  │
│  │ sentinel-api │──▶│    Redis     │◀──│  sentinel-  │  │
│  │  (FastAPI)   │   │   (broker)   │   │   worker    │  │
│  │  uvicorn     │   └──────────────┘   │  (Celery)   │  │
│  └──────┬───────┘                      └──────┬──────┘  │
│         │                                     │         │
│  ┌──────▼───────┐   ┌──────────────────────────▼─────┐  │
│  │  PostgreSQL  │   │  expandable-vault (S3-compat)  │  │
│  │  (database)  │   │  models/*.pkl, datasets/*.csv  │  │
│  └──────────────┘   └────────────────────────────────┘  │
└─────────────────────────────────────────────────────────┘
```

### Current Services

| Service | Railway Config | Purpose |
|---------|---------------|---------|
| sentinel-api | `uvicorn app.main:app --host 0.0.0.0 --port $PORT` | FastAPI REST API, model inference, policy engine |
| sentinel-worker | `celery -A app.celery_app:celery_app worker --loglevel=info --concurrency=1 --pool=prefork` | ML training pipeline (Celery) |
| Redis | Railway managed | Celery broker + training event store |
| PostgreSQL | Railway managed | Users, models, datasets, policies, decisions |
| expandable-vault | S3-compatible (t3.storageapi.dev) | Pickled models, uploaded CSVs |

### Current Environment Variables (both services)

```
ENV=production
STORAGE_TYPE=s3
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
SECRET_KEY=...
CORS_ORIGINS=https://your-domain.vercel.app
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
AWS_ENDPOINT_URL=https://t3.storageapi.dev
S3_BUCKET=...
CELERY_WORKER=1  (worker only)
```

---

## 3. Target Architecture (AWS via Flightcontrol)

```
┌─────────────────────────────────────────────────────────┐
│  Vercel (Frontend) — unchanged                          │
│  - VITE_API_URL → ALB endpoint (HTTPS)                  │
└──────────────────────┬──────────────────────────────────┘
                       │ HTTPS
┌──────────────────────▼──────────────────────────────────┐
│  AWS (managed via Flightcontrol)                        │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  VPC (private subnets)                          │    │
│  │                                                 │    │
│  │  ┌───────────┐  ┌─────────────┐  ┌──────────┐  │    │
│  │  │    ALB    │─▶│ ECS Fargate │  │   ECS    │  │    │
│  │  │ (public)  │  │ sentinel-api│  │  Fargate │  │    │
│  │  └───────────┘  │ 0.5vCPU/1GB │  │  worker  │  │    │
│  │                 └──────┬──────┘  │ 2vCPU/4GB│  │    │
│  │                        │         └────┬─────┘  │    │
│  │                 ┌──────▼──────┐       │        │    │
│  │                 │ ElastiCache │◀──────┘        │    │
│  │                 │   Redis     │                │    │
│  │                 └─────────────┘                │    │
│  │                 ┌─────────────┐                │    │
│  │                 │ RDS Aurora  │◀───────────────┘    │
│  │                 │ PostgreSQL  │                     │
│  │                 │ Serverless  │                     │
│  │                 └─────────────┘                     │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  S3 Bucket: sentinel-models-prod                │    │
│  │  models/*.pkl, datasets/*.csv                   │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  ECR: sentinel-console (Docker image registry)  │    │
│  └─────────────────────────────────────────────────┘    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │  Secrets Manager: sentinel-prod/*               │    │
│  └─────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### AWS Services Used

| Service | Spec | Purpose | Why This Choice |
|---------|------|---------|-----------------|
| **ECS Fargate** (API) | 0.5 vCPU / 1 GB | FastAPI server | No servers to manage, auto-scaling, same Dockerfile |
| **ECS Fargate** (Worker) | 2 vCPU / 4 GB | Celery training | More CPU/RAM for ML, scales to 0 when idle |
| **RDS Aurora Serverless v2** | 0.5–2 ACU, PostgreSQL 15 | Database | Auto-scales, multi-AZ, automated backups |
| **ElastiCache Serverless** | Redis 7+ | Celery broker + events | Managed Redis, same protocol as Railway |
| **S3** | Standard tier | Model artifacts + datasets | Native S3 (no more compatibility layer) |
| **ALB** | Application Load Balancer | HTTPS ingress | SSL termination, health checks, path routing |
| **ECR** | Docker registry | Container images | Private registry in same region |
| **Secrets Manager** | — | SECRET_KEY, DB creds | IAM-integrated, no env var leaks |
| **ACM** | — | SSL certificate | Free managed certificates for ALB |
| **CloudWatch** | — | Logs + metrics | Centralized observability |
| **Flightcontrol** | Pro plan | Deployment UI | Railway-like dashboard over real AWS |

### Why NOT SageMaker

SageMaker is purpose-built for GPU training, large-scale MLOps, and managed inference endpoints. Sentinel's use case doesn't benefit:

| Concern | SageMaker | Current Approach |
|---------|-----------|-----------------|
| Training | Managed training jobs on GPU/CPU clusters | Celery worker with sklearn/xgboost — CPU is sufficient |
| Inference | Dedicated endpoint (~$50-80/mo always-on) | In-process `joblib.load` + `predict_proba` — sub-millisecond |
| Latency | API → SageMaker endpoint → response (+50-100ms) | Direct in-memory scoring (0ms network overhead) |
| Model format | Requires SageMaker serving container | Standard pickle — already works |
| Cost | $50-80/mo per endpoint, per model | $0 incremental (runs in API process) |
| Complexity | Rewrite inference layer, new deployment pipeline | Zero code changes |

**Revisit SageMaker when:** You need GPU inference (deep learning), 20+ models in production, or a dedicated ML engineering team with experiment tracking needs.

---

## 4. Migration Steps

### Phase 0: Preparation (Week 1)

**0.1 — Create AWS account and configure Flightcontrol**
- Sign up for AWS (if not already)
- Create IAM admin user for Flightcontrol
- Sign up for Flightcontrol Pro ($49/mo), connect AWS account
- Connect GitHub repo (mishuk77/sentinel-console)

**0.2 — Choose AWS region**
- Recommended: `us-east-1` (cheapest, most services available)
- If users are primarily elsewhere, choose closest region

**0.3 — Audit environment variables**
- Export all Railway env vars for both services
- Identify which become AWS-native (DATABASE_URL, REDIS_URL) vs manual (SECRET_KEY, CORS_ORIGINS)

### Phase 1: Infrastructure (Week 1-2)

**1.1 — Create S3 bucket**
```
Bucket: sentinel-models-prod
Region: us-east-1
Versioning: Enabled
Encryption: AES-256 (SSE-S3)
Public access: Blocked (all)
Lifecycle: Move to Infrequent Access after 90 days
```

**1.2 — Migrate data from Railway vault to S3**
```bash
# From a machine with both credentials:
# Download from Railway vault
aws s3 sync s3://railway-bucket/ ./migration-tmp/ \
  --endpoint-url https://t3.storageapi.dev

# Upload to AWS S3
aws s3 sync ./migration-tmp/ s3://sentinel-models-prod/
```
Verify: All `models/*.pkl` and `datasets/*.csv` files present.

**1.3 — Create RDS Aurora Serverless v2**
- Engine: PostgreSQL 15
- Min capacity: 0.5 ACU
- Max capacity: 2 ACU (adjust based on load)
- Multi-AZ: Yes
- VPC: Flightcontrol-managed VPC (private subnet)
- Security group: Allow inbound 5432 from Fargate tasks only

**1.4 — Migrate database**
```bash
# Export from Railway
pg_dump "$RAILWAY_DATABASE_URL" --no-owner --no-acl > sentinel_dump.sql

# Import to Aurora
psql "$AURORA_DATABASE_URL" < sentinel_dump.sql
```
Verify: Tables, row counts, model records with artifact_paths match.

**1.5 — Create ElastiCache Redis**
- Engine: Redis 7 (Serverless)
- VPC: Same as RDS (private subnet)
- Security group: Allow inbound 6379 from Fargate tasks only
- No data migration needed (Redis is ephemeral — broker + event store)

### Phase 2: Compute (Week 2)

**2.1 — Push Docker image to ECR**
```bash
# Create ECR repository
aws ecr create-repository --repository-name sentinel-console

# Build and push (same Dockerfile already in repo)
docker build -t sentinel-console ./backend
docker tag sentinel-console:latest <account>.dkr.ecr.us-east-1.amazonaws.com/sentinel-console:latest
docker push <account>.dkr.ecr.us-east-1.amazonaws.com/sentinel-console:latest
```

**2.2 — Configure Flightcontrol services**

In the Flightcontrol dashboard, create two services from the same repo:

**Service 1: sentinel-api**
```yaml
name: sentinel-api
type: fargate
cpu: 256    # 0.25 vCPU (can scale up)
memory: 512 # 512 MB
port: 8000
healthCheck: /api/v1/health
command: uvicorn app.main:app --host 0.0.0.0 --port 8000
minInstances: 1
maxInstances: 2
envVars:
  ENV: production
  STORAGE_TYPE: s3
  S3_BUCKET: sentinel-models-prod
  # AWS_ACCESS_KEY_ID/SECRET not needed — use IAM task role
  CORS_ORIGINS: https://your-domain.vercel.app
  # DATABASE_URL, REDIS_URL auto-injected by Flightcontrol
  # SECRET_KEY from Secrets Manager
```

**Service 2: sentinel-worker**
```yaml
name: sentinel-worker
type: fargate
cpu: 2048   # 2 vCPU for ML training
memory: 4096 # 4 GB
command: celery -A app.celery_app:celery_app worker --loglevel=info --concurrency=1 --pool=prefork
minInstances: 1
maxInstances: 1
envVars:
  # Same as API plus:
  CELERY_WORKER: "1"
```

**2.3 — Configure IAM task role**
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject",
        "s3:PutObject",
        "s3:ListBucket"
      ],
      "Resource": [
        "arn:aws:s3:::sentinel-models-prod",
        "arn:aws:s3:::sentinel-models-prod/*"
      ]
    }
  ]
}
```
This eliminates the need for `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` environment variables. The Fargate task assumes this role automatically.

**2.4 — Code change: support IAM role-based S3 auth**

In `backend/app/services/storage.py`, the boto3 client should fall back to IAM credentials when no explicit keys are provided. boto3 does this automatically — just stop passing `aws_access_key_id` and `aws_secret_access_key` when they're empty. Also remove `endpoint_url` for native S3.

```python
# When on AWS (no endpoint_url), boto3 uses IAM role automatically
if settings.AWS_ENDPOINT_URL:
    # Railway / custom S3-compatible
    client = boto3.client("s3",
        endpoint_url=settings.AWS_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY)
else:
    # Native AWS — IAM role from Fargate task
    client = boto3.client("s3", region_name=settings.AWS_REGION or "us-east-1")
```

This is the **only code change** required for the migration.

### Phase 3: Networking & Security (Week 2)

**3.1 — ALB + HTTPS**
- Flightcontrol auto-creates the ALB
- Request ACM certificate for your API domain (e.g., `api.sentinel.yourdomain.com`)
- Attach certificate to ALB listener (443)
- Redirect HTTP → HTTPS

**3.2 — Security group rules**
```
ALB (public subnet):
  Inbound: 443 from 0.0.0.0/0

sentinel-api (private subnet):
  Inbound: 8000 from ALB security group

sentinel-worker (private subnet):
  Inbound: none (outbound-only)

RDS (private subnet):
  Inbound: 5432 from sentinel-api SG, sentinel-worker SG

ElastiCache (private subnet):
  Inbound: 6379 from sentinel-api SG, sentinel-worker SG
```

**3.3 — Secrets Manager**
Store these in AWS Secrets Manager (not env vars):
- `SECRET_KEY`
- `DATABASE_URL` (if not auto-injected by Flightcontrol)
- Any other sensitive values

### Phase 4: CI/CD (Week 2-3)

**4.1 — GitHub Actions pipeline**

Flightcontrol handles this automatically when you connect your GitHub repo. On push to `main`:
1. Flightcontrol detects the push
2. Builds Docker image from `backend/Dockerfile`
3. Pushes to ECR
4. Updates ECS services (rolling deployment — zero downtime)

No GitHub Actions config needed if using Flightcontrol's built-in CI.

### Phase 5: Validation (Week 3)

**5.1 — Smoke tests**
- [ ] API health check returns 200
- [ ] Login / JWT auth works
- [ ] List datasets returns existing data
- [ ] Upload a new CSV dataset → verify it lands in S3
- [ ] Download a dataset → verify original file
- [ ] Start training → verify Celery worker picks it up
- [ ] Training completes → all 5 models show CANDIDATE status
- [ ] Pipeline log shows all events (Redis event store working)
- [ ] Model inference: POST /decide returns score + decision
- [ ] Policy page: threshold slider works, calibration data loads
- [ ] Exposure control: amount ladder loads, impact simulation renders
- [ ] Fraud pipeline (if applicable): fraud scoring + tier assignment

**5.2 — Performance baseline**
- [ ] Training time for 6,000-row dataset (should be similar or faster)
- [ ] Training time for 30,000-row dataset
- [ ] Inference latency (first call — cold model load from S3)
- [ ] Inference latency (subsequent calls — cached)
- [ ] API response time for dashboard/model list pages

**5.3 — Reliability test**
- [ ] Restart API service — verify model cache rebuilds on next inference
- [ ] Restart worker — verify in-progress training emits proper error events
- [ ] Simulate worker crash — verify FAILED state shows on frontend

### Phase 6: Cutover (Week 3)

**6.1 — DNS switch**
- Update Vercel env: `VITE_API_URL=https://api.sentinel.yourdomain.com`
- Redeploy frontend

**6.2 — Decommission Railway**
- Keep Railway running for 1 week as fallback
- After 1 week with no issues, delete Railway services
- Revoke Railway S3 credentials

---

## 5. Cost Estimate

| Service | Spec | Monthly Estimate |
|---------|------|-----------------|
| Flightcontrol Pro | Dashboard + CI/CD | $49 |
| ECS Fargate (API) | 0.25 vCPU / 512 MB, always-on | ~$10 |
| ECS Fargate (Worker) | 2 vCPU / 4 GB, ~10 hrs/mo usage | ~$5–30 |
| RDS Aurora Serverless v2 | 0.5–2 ACU PostgreSQL | ~$15–40 |
| ElastiCache Serverless | Redis, minimal usage | ~$10 |
| S3 | <1 GB storage + requests | ~$1 |
| ALB | Always-on | ~$16 |
| ECR | Image storage | ~$1 |
| Secrets Manager | 5 secrets | ~$2 |
| CloudWatch | Logs | ~$3 |
| **Total** | | **~$110–160/mo** |

Railway Pro (current): ~$60-100/mo depending on usage.
Delta: ~$50-60/mo more for significantly better reliability and security.

---

## 6. Code Changes Required

Only **one file** needs modification:

### `backend/app/services/storage.py`
Add IAM role fallback for native AWS S3 (no access keys needed when running on Fargate):

```python
# If no custom endpoint (native AWS), use IAM role credentials
if not settings.AWS_ENDPOINT_URL:
    self._client = boto3.client("s3", region_name=settings.AWS_REGION or "us-east-1")
else:
    # Railway / S3-compatible endpoint
    self._client = boto3.client("s3",
        endpoint_url=settings.AWS_ENDPOINT_URL,
        aws_access_key_id=settings.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=settings.AWS_SECRET_ACCESS_KEY)
```

### `backend/app/core/config.py`
Add optional `AWS_REGION` field:
```python
AWS_REGION: str = "us-east-1"
```

Everything else — Dockerfile, Celery config, training pipeline, inference, frontend — remains unchanged.

---

## 7. Rollback Plan

If issues arise post-migration:

1. **Frontend:** Change `VITE_API_URL` back to Railway endpoint, redeploy on Vercel (2 minutes)
2. **Data:** Railway Postgres and S3 vault are still intact (keep for 1 week post-cutover)
3. **No data sync needed:** Railway was the source of truth until cutover; any new data in AWS can be exported via `pg_dump` + `aws s3 sync` if needed

---

## 8. Timeline Summary

| Week | Phase | Tasks |
|------|-------|-------|
| 1 | Preparation | AWS account, Flightcontrol setup, audit env vars |
| 1-2 | Infrastructure | S3 bucket, RDS, ElastiCache, data migration |
| 2 | Compute | ECR push, Fargate services, IAM roles, code change |
| 2 | Networking | ALB, HTTPS, security groups, secrets |
| 3 | Validation | Smoke tests, performance baseline, reliability tests |
| 3 | Cutover | DNS switch, frontend redeploy, decommission Railway |

**Total estimated effort:** 2-3 focused days of work, spread across 2-3 weeks for safe validation.

---

## 9. References

- [Flightcontrol Docs](https://www.flightcontrol.dev/docs)
- [ECS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Aurora Serverless v2 Pricing](https://aws.amazon.com/rds/aurora/pricing/)
- [ElastiCache Serverless Pricing](https://aws.amazon.com/elasticache/pricing/)
- Current Railway config: `backend/railway.toml`
- Current Dockerfile: `backend/Dockerfile`
- Storage service: `backend/app/services/storage.py`
- Decision/inference service: `backend/app/services/decision_service.py`
