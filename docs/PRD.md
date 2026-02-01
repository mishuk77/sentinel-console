# Sentinel Decision Systems
## Product Requirements Document (PRD)

**Version:** 1.0
**Last Updated:** February 2026
**Status:** Active Development

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Target Users](#3-target-users)
4. [Product Overview](#4-product-overview)
5. [Core Modules](#5-core-modules)
6. [Technical Architecture](#6-technical-architecture)
7. [Data Models](#7-data-models)
8. [API Specifications](#8-api-specifications)
9. [Security & Compliance](#9-security--compliance)
10. [Non-Functional Requirements](#10-non-functional-requirements)
11. [Implementation Roadmap](#11-implementation-roadmap)
12. [Success Metrics](#12-success-metrics)

---

## 1. Executive Summary

### Vision

Sentinel Decision Systems is a comprehensive ML-powered financial decisioning platform that enables fintech companies, banks, and lenders to build, deploy, and manage automated credit risk and fraud detection systems without requiring deep data science expertise.

### Mission

Democratize access to sophisticated decisioning technology by providing an integrated platform that handles the entire lifecycle—from data ingestion and model training to policy configuration and real-time decision serving—while maintaining the transparency and control that regulated financial institutions require.

### Value Proposition

- **Speed to Market**: Deploy production-ready decisioning in weeks, not months
- **Unified Platform**: Single system for credit risk, fraud, and exposure management
- **Explainability**: Full audit trails and model interpretability for regulatory compliance
- **Flexibility**: Support for custom rules, ML models, and hybrid approaches
- **Scalability**: Handle millions of decisions per day with sub-100ms latency

---

## 2. Problem Statement

### Industry Challenges

1. **Fragmented Tooling**: Financial institutions use separate systems for credit scoring, fraud detection, and portfolio management, leading to integration complexity and data silos.

2. **Technical Debt**: Legacy decisioning systems are difficult to update, lack ML capabilities, and cannot adapt to changing market conditions quickly.

3. **Compliance Burden**: Regulatory requirements (FCRA, ECOA, GDPR) demand explainability and audit trails that most ML systems don't provide out of the box.

4. **Resource Constraints**: Building in-house decisioning requires scarce data science talent, significant infrastructure investment, and ongoing maintenance.

5. **Fraud Evolution**: Fraud patterns evolve rapidly; static rule-based systems cannot keep pace without ML augmentation.

### Current Alternatives

| Solution | Limitations |
|----------|-------------|
| Build In-House | 12-18 month timeline, $2M+ investment, ongoing maintenance |
| Legacy Vendors (FICO, Experian) | Expensive, inflexible, slow to innovate |
| Point Solutions | Integration complexity, no unified view |
| Generic ML Platforms | Lack financial domain expertise, no compliance features |

### Sentinel's Differentiation

- Purpose-built for financial decisioning with compliance built-in
- Unified platform eliminating integration overhead
- No-code/low-code interface for business users
- ML-powered with full explainability
- Real-time and batch processing capabilities

---

## 3. Target Users

### Primary Personas

#### 3.1 Credit Risk Manager
**Role**: Owns credit policy and approval criteria
**Goals**:
- Set and adjust approval thresholds
- Monitor portfolio performance
- Balance growth with risk appetite

**Pain Points**:
- Cannot quickly test policy changes
- Limited visibility into model behavior
- Slow feedback loop on policy effectiveness

**Sentinel Features Used**:
- Policy Configuration
- Decile Analysis
- Exposure Control
- A/B Testing

#### 3.2 Fraud Operations Manager
**Role**: Manages fraud prevention and investigation
**Goals**:
- Minimize fraud losses
- Reduce false positives
- Meet SLA targets for case review

**Pain Points**:
- Alert fatigue from rule-based systems
- Cannot prioritize high-risk cases effectively
- Manual processes slow investigation

**Sentinel Features Used**:
- Fraud Dashboard
- Case Queue
- Rule Builder
- ML Models

#### 3.3 Fraud Analyst
**Role**: Reviews flagged applications and makes decisions
**Goals**:
- Process cases quickly
- Make accurate decisions
- Document findings properly

**Pain Points**:
- Scattered information across systems
- No guidance on what to investigate
- Repetitive verification workflows

**Sentinel Features Used**:
- Case Detail View
- Verification Actions
- Decision Recording

#### 3.4 Data Scientist
**Role**: Builds and maintains ML models
**Goals**:
- Improve model performance
- Deploy models safely
- Monitor model drift

**Pain Points**:
- Long deployment cycles
- No A/B testing infrastructure
- Manual monitoring processes

**Sentinel Features Used**:
- Model Training
- Feature Engineering
- Model Registry
- Performance Monitoring

#### 3.5 Compliance Officer
**Role**: Ensures regulatory compliance
**Goals**:
- Maintain audit trails
- Ensure fair lending practices
- Respond to regulatory inquiries

**Pain Points**:
- Cannot explain model decisions
- Missing documentation
- Manual report generation

**Sentinel Features Used**:
- Decision Logs
- Reason Codes
- Audit Reports
- Model Documentation

### Secondary Personas

- **Engineering Team**: Integrates Sentinel via API
- **Executive Leadership**: Reviews dashboards and KPIs
- **Customer Support**: Looks up decision details for customer inquiries

---

## 4. Product Overview

### System Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         SENTINEL PLATFORM                            │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌────────────┐ │
│  │   Credit    │  │    Fraud    │  │  Exposure   │  │ Integration│ │
│  │    Risk     │  │ Management  │  │   Control   │  │   & API    │ │
│  └─────────────┘  └─────────────┘  └─────────────┘  └────────────┘ │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    ML Engine & Rule Engine                    │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│   │
│  │  │  Model   │ │  Model   │ │   Rule   │ │     Decision     ││   │
│  │  │ Training │ │ Serving  │ │Evaluation│ │    Orchestrator  ││   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                      Data Layer                               │   │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────────────┐│   │
│  │  │PostgreSQL│ │  Redis   │ │   S3     │ │   TimescaleDB    ││   │
│  │  │ (Primary)│ │ (Cache)  │ │(Datasets)│ │    (Metrics)     ││   │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────────────┘│   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### Decision Flow

```
                    ┌─────────────────┐
                    │  API Request    │
                    │  (Application)  │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  Data Enrichment │
                    │  (Signal Fetch)  │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐    │    ┌────────▼────────┐
     │   ML Scoring    │    │    │  Rule Engine    │
     │  (Credit/Fraud) │    │    │  (Business)     │
     └────────┬────────┘    │    └────────┬────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │    Policy       │
                    │   Evaluation    │
                    └────────┬────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
     ┌────────▼────────┐    │    ┌────────▼────────┐
     │  Auto-Decision  │    │    │  Manual Queue   │
     │  (Approve/Deny) │    │    │  (Review)       │
     └────────┬────────┘    │    └────────┬────────┘
              │              │              │
              └──────────────┼──────────────┘
                             │
                    ┌────────▼────────┐
                    │  Decision Log   │
                    │  + Reason Codes │
                    └────────┬────────┘
                             │
                    ┌────────▼────────┐
                    │  API Response   │
                    └─────────────────┘
```

---

## 5. Core Modules

### 5.1 Decision Systems (Workspaces)

**Purpose**: Provide isolated environments for different decisioning contexts (e.g., Personal Loans, Auto Loans, Credit Cards).

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Create System | Initialize a new decision system workspace | P0 |
| System Overview | Dashboard showing key metrics and status | P0 |
| System Settings | Configure system-level parameters | P1 |
| Clone System | Duplicate a system for testing | P2 |
| Archive System | Soft-delete with data retention | P1 |

**User Stories**:
- As a Risk Manager, I want to create separate systems for each product line so that policies don't interfere with each other.
- As a Compliance Officer, I want to see which model and policy version was active at any point in time.

---

### 5.2 Data Management

**Purpose**: Ingest, validate, and manage training datasets for ML models.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Dataset Upload | Upload CSV/Parquet files with validation | P0 |
| Schema Detection | Auto-detect column types and statistics | P0 |
| Data Profiling | Show distributions, missing values, outliers | P1 |
| Feature Registry | Catalog available features with metadata | P1 |
| Data Versioning | Track dataset versions over time | P2 |
| External Connectors | Pull from S3, Snowflake, BigQuery | P2 |

**Data Validation Rules**:
- Required columns present
- No duplicate row IDs
- Target variable is binary (for classification)
- Date formats are valid
- Numeric ranges are reasonable

**User Stories**:
- As a Data Scientist, I want to upload historical loan data so I can train a credit risk model.
- As a Risk Manager, I want to see data quality metrics before training a model.

---

### 5.3 Model Training & Registry

**Purpose**: Train, validate, and manage ML models for credit scoring and fraud detection.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| AutoML Training | One-click model training with sensible defaults | P0 |
| Algorithm Selection | Choose from XGBoost, LightGBM, Neural Net, etc. | P0 |
| Hyperparameter Tuning | Grid search or Bayesian optimization | P1 |
| Cross-Validation | K-fold CV with stratification | P0 |
| Model Comparison | Side-by-side metrics comparison | P1 |
| Model Registry | Version control for trained models | P0 |
| Model Activation | Promote model to production | P0 |
| A/B Testing | Split traffic between models | P2 |

**Supported Algorithms**:

| Algorithm | Use Case | Training Time |
|-----------|----------|---------------|
| XGBoost | General purpose, interpretable | Fast |
| LightGBM | Large datasets, high performance | Fast |
| Random Forest | Baseline, robust | Medium |
| Neural Network | Complex patterns | Slow |
| Logistic Regression | Highly interpretable | Very Fast |
| Ensemble | Production, best accuracy | Slow |

**Model Metrics**:
- AUC-ROC (primary)
- Gini Coefficient
- KS Statistic
- Precision/Recall at threshold
- Calibration curves
- Feature importance
- SHAP values (explainability)

**User Stories**:
- As a Data Scientist, I want to train multiple models and compare their performance.
- As a Risk Manager, I want to understand which features drive model predictions.
- As a Compliance Officer, I want model documentation for regulatory review.

---

### 5.4 Policy Configuration

**Purpose**: Define approval thresholds and decision rules based on model scores.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Threshold Setting | Set approve/decline cutoffs | P0 |
| Decile Analysis | View performance by score bands | P0 |
| Policy Simulation | Test policy on historical data | P0 |
| Approval Rate Targeting | Set desired approval rate | P1 |
| Multi-Factor Policies | Combine score + rules | P1 |
| Policy Versioning | Track policy changes over time | P0 |
| Policy A/B Testing | Compare policies in production | P2 |

**Policy Configuration Options**:

```yaml
policy:
  name: "Standard Personal Loan"
  model_id: "model_abc123"

  # Score-based thresholds
  auto_approve_above: 720
  auto_decline_below: 580
  manual_review_range: [580, 720]

  # Override rules
  hard_stops:
    - condition: "bankruptcy_last_7_years = true"
      action: "decline"
      reason: "R001"
    - condition: "debt_to_income > 0.50"
      action: "decline"
      reason: "R002"

  # Soft rules (flag for review)
  review_triggers:
    - condition: "employment_length_months < 6"
      flag: "SHORT_EMPLOYMENT"
```

**User Stories**:
- As a Risk Manager, I want to adjust approval thresholds and see projected impact immediately.
- As a Credit Analyst, I want to understand why an application was declined.

---

### 5.5 Fraud Management

**Purpose**: Detect, investigate, and decision potential fraud cases.

#### 5.5.1 Fraud Scoring

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Real-time Scoring | Score applications at submission | P0 |
| Signal Aggregation | Combine device, identity, velocity signals | P0 |
| Score Breakdown | Show contributing factors | P0 |
| Score History | Track score changes over time | P1 |

**Signal Types**:

| Category | Signals |
|----------|---------|
| Device | Emulator detection, VPN/proxy, device age, fingerprint |
| Identity | SSN validation, synthetic ID score, watchlist, deceased |
| Velocity | Same device/SSN/email/IP frequency |
| Behavioral | Session duration, typing patterns, mouse movement |

**Risk Levels**:

| Level | Score Range | SLA | Action |
|-------|-------------|-----|--------|
| Critical | 800-1000 | 15 min | Immediate review |
| High | 600-799 | 1 hour | Priority queue |
| Medium | 400-599 | 4 hours | Standard queue |
| Low | 0-399 | 24 hours | Batch review or auto-approve |

#### 5.5.2 Case Queue

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Risk-Prioritized Queue | Sort by score and SLA | P0 |
| Queue Filtering | Filter by level, status, analyst | P0 |
| Case Assignment | Manual or auto-assign | P0 |
| SLA Tracking | Visual countdown, breach alerts | P0 |
| Batch Actions | Bulk approve/decline | P1 |

#### 5.5.3 Case Investigation

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Case Detail View | All signals and scores in one place | P0 |
| Signal Deep-Dive | Expand individual signals | P0 |
| Verification Actions | Initiate OTP, KBA, document requests | P0 |
| Verification Tracking | Real-time status updates | P0 |
| Decision Recording | Approve/decline with reason | P0 |
| Case Notes | Free-form investigation notes | P1 |
| Similar Cases | Link potentially related applications | P2 |

**Verification Types**:

| Type | Description | Auto/Manual |
|------|-------------|-------------|
| OTP SMS | Send one-time code via SMS | Automated |
| OTP Email | Send one-time code via email | Automated |
| KBA | Knowledge-based authentication questions | Automated |
| Document Upload | Request ID/proof of address | Manual |
| Video Call | Live video verification | Manual |
| Manual Call | Phone verification | Manual |

#### 5.5.4 Fraud Rules

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Visual Rule Builder | No-code rule creation | P0 |
| Condition Logic | AND/OR combinations | P0 |
| Rule Actions | Flag, adjust score, decline, escalate | P0 |
| Rule Simulation | Test on historical data | P0 |
| Rule Priority | Ordered evaluation | P1 |
| Rule Templates | Pre-built common rules | P1 |

**Available Rule Fields**:
- Score fields (fraud_score, identity_score, device_score, etc.)
- Device signals (is_emulator, is_vpn, device_age_days, etc.)
- Velocity metrics (apps_same_device_24h, apps_same_ssn_7d, etc.)
- Identity signals (ssn_mismatch, watchlist_hit, etc.)
- Application data (requested_amount, applicant_state, etc.)

#### 5.5.5 Fraud ML Models

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Model Training | Train fraud detection models | P1 |
| Feature Selection | Choose signals for training | P1 |
| Model Metrics | AUC, precision, recall, detection rate | P1 |
| Feature Importance | Understand model drivers | P1 |
| Model Activation | Deploy to production | P1 |
| Model Versioning | Track model history | P1 |

#### 5.5.6 Signal Providers

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Provider Configuration | API keys, endpoints | P1 |
| Provider Testing | Connection verification | P1 |
| Performance Metrics | Latency, success rate | P1 |
| Cost Tracking | Per-call costs | P2 |
| Fallback Logic | Handle provider failures | P2 |

**Supported Provider Types**:
- Identity (Socure, Alloy, Onfido)
- Device (Sardine, Sift, ThreatMetrix)
- Behavioral (BioCatch, NeuroID)
- Consortium (Plaid, MX)
- Bureau (Experian, TransUnion)

#### 5.5.7 Fraud Automation

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Auto-Assignment | Distribute cases to analysts | P1 |
| Auto-Decisioning | Approve/decline based on score | P1 |
| Escalation Rules | Timeout-based escalation | P1 |
| Notifications | Email, Slack, webhook alerts | P1 |
| Batch Review | Process multiple cases at once | P2 |

**Automation Settings**:

```yaml
automation:
  auto_assign:
    enabled: true
    strategy: "load_balanced"  # round_robin, load_balanced, skill_based
    max_cases_per_analyst: 25

  auto_decision:
    enabled: true
    auto_approve_below: 200
    auto_decline_above: 900

  escalation:
    timeout_minutes: 60
    auto_escalate: true

  notifications:
    critical_cases: true
    sla_breach: true
    channels: ["email", "slack"]
```

**User Stories**:
- As a Fraud Manager, I want high-risk cases to be reviewed first.
- As a Fraud Analyst, I want to see all relevant signals without switching systems.
- As a Fraud Manager, I want to create rules without writing code.
- As a Compliance Officer, I want audit logs of all fraud decisions.

---

### 5.6 Exposure Control

**Purpose**: Manage portfolio-level risk limits and concentration.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Limit Configuration | Set lending limits by segment | P1 |
| Utilization Tracking | Real-time limit usage | P1 |
| Limit Alerts | Warnings at thresholds | P1 |
| Segment Analysis | View exposure by risk tier, geography, etc. | P1 |
| Limit Adjustment | Modify limits with approval workflow | P2 |
| Historical Trends | Track exposure over time | P2 |

**Limit Types**:
- Total portfolio exposure
- Exposure by risk tier (A, B, C, D)
- Exposure by geography (state/region)
- Exposure by product type
- Single borrower concentration

**User Stories**:
- As a Risk Manager, I want to cap exposure to high-risk borrowers.
- As a Portfolio Manager, I want alerts when approaching limits.

---

### 5.7 Integration & API

**Purpose**: Enable external systems to request decisions and receive results.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| REST API | Standard decision request/response | P0 |
| API Keys | Secure authentication | P0 |
| Rate Limiting | Protect against abuse | P0 |
| Webhooks | Push decision events | P1 |
| Batch API | Process multiple applications | P1 |
| SDK (Python) | Client library | P2 |
| SDK (JavaScript) | Client library | P2 |

**Decision API**:

```
POST /api/v1/systems/{system_id}/decide

Request:
{
  "application_id": "app_123",
  "applicant": {
    "first_name": "John",
    "last_name": "Smith",
    "ssn": "123-45-6789",
    "email": "john@example.com",
    "phone": "+1234567890"
  },
  "application": {
    "requested_amount": 10000,
    "term_months": 36,
    "purpose": "debt_consolidation"
  },
  "device": {
    "fingerprint": "fp_abc123",
    "ip_address": "192.168.1.1",
    "user_agent": "Mozilla/5.0..."
  }
}

Response:
{
  "decision_id": "dec_456",
  "decision": "APPROVED",
  "score": 742,
  "reason_codes": ["R001", "R002"],
  "reason_descriptions": [
    "Strong credit history",
    "Low debt-to-income ratio"
  ],
  "conditions": [],
  "expires_at": "2024-01-15T12:00:00Z"
}
```

---

### 5.8 Analytics & Reporting

**Purpose**: Provide insights into decisioning performance and portfolio health.

**Features**:

| Feature | Description | Priority |
|---------|-------------|----------|
| Dashboard | Key metrics overview | P0 |
| Decision Volume | Approve/decline trends | P0 |
| Score Distribution | Population stability | P1 |
| Model Performance | Ongoing AUC, Gini tracking | P1 |
| Fraud Metrics | Detection rate, false positives | P1 |
| Custom Reports | Build ad-hoc reports | P2 |
| Scheduled Reports | Automated delivery | P2 |
| Data Export | Download for external analysis | P1 |

**Key Metrics**:

| Metric | Description | Target |
|--------|-------------|--------|
| Approval Rate | % of applications approved | 40-60% |
| Fraud Rate | % of approvals that default to fraud | <1% |
| False Positive Rate | % of legitimate apps flagged as fraud | <5% |
| Decision Latency (p95) | Time to return decision | <100ms |
| SLA Compliance | % of fraud cases resolved in SLA | >95% |
| Model AUC | Predictive accuracy | >0.75 |

---

## 6. Technical Architecture

### 6.1 Frontend

**Technology Stack**:
- React 19 with TypeScript
- React Router 7 (routing)
- TanStack Query (data fetching)
- Tailwind CSS (styling)
- Recharts (visualization)
- Vite (build tool)

**Key Principles**:
- Component-based architecture
- Optimistic UI updates
- Dark mode support
- Responsive design (desktop-first)
- Accessibility (WCAG 2.1 AA)

**Directory Structure**:
```
frontend/src/
├── components/       # Reusable UI components
│   ├── ui/          # Primitives (Button, Input, etc.)
│   └── layout/      # Layout components
├── pages/           # Route-level components
├── lib/             # Utilities, API client, hooks
└── assets/          # Static assets
```

### 6.2 Backend

**Technology Stack**:
- Python 3.11+
- FastAPI (web framework)
- SQLAlchemy 2.0 (ORM)
- PostgreSQL 15+ (primary database)
- Redis (caching, queues)
- Alembic (migrations)
- Pydantic 2.0 (validation)

**Key Principles**:
- Async-first for I/O operations
- Repository pattern for data access
- Dependency injection
- Structured logging
- OpenAPI documentation

**Directory Structure**:
```
backend/app/
├── api/
│   └── routes/      # API endpoint handlers
├── core/            # Configuration, security
├── db/              # Database session, migrations
├── models/          # SQLAlchemy models
├── schemas/         # Pydantic schemas
├── services/        # Business logic
└── ml/              # Model training, serving
```

### 6.3 ML Infrastructure

**Training Pipeline**:
```
Dataset → Validation → Feature Engineering → Training → Evaluation → Registry
```

**Serving Pipeline**:
```
Request → Feature Fetch → Model Inference → Post-processing → Response
```

**Model Storage**:
- Model artifacts: S3
- Model metadata: PostgreSQL
- Feature store: Redis (hot), PostgreSQL (cold)

### 6.4 Infrastructure

**Deployment**:
- Frontend: Vercel (CDN, Edge)
- Backend: Railway / AWS ECS
- Database: Railway PostgreSQL / AWS RDS
- Cache: Railway Redis / AWS ElastiCache
- Storage: AWS S3

**Environments**:
- Development (local)
- Staging (pre-production)
- Production

---

## 7. Data Models

### 7.1 Core Entities

```
┌─────────────────┐
│ DecisionSystem  │
├─────────────────┤
│ id              │
│ name            │
│ description     │
│ active_model_id │◄──────┐
│ active_policy_id│◄────┐ │
│ created_at      │     │ │
└─────────────────┘     │ │
         │              │ │
         │ has many     │ │
         ▼              │ │
┌─────────────────┐     │ │
│    Dataset      │     │ │
├─────────────────┤     │ │
│ id              │     │ │
│ system_id (FK)  │     │ │
│ s3_key          │     │ │
│ status          │     │ │
│ metadata        │     │ │
│ created_at      │     │ │
└─────────────────┘     │ │
         │              │ │
         │ used by      │ │
         ▼              │ │
┌─────────────────┐     │ │
│    MLModel      │─────┘ │
├─────────────────┤       │
│ id              │       │
│ system_id (FK)  │       │
│ dataset_id (FK) │       │
│ name            │       │
│ algorithm       │       │
│ status          │       │
│ metrics (JSON)  │       │
│ created_at      │       │
└─────────────────┘       │
         │                │
         │ used by        │
         ▼                │
┌─────────────────┐       │
│     Policy      │───────┘
├─────────────────┤
│ id              │
│ system_id (FK)  │
│ model_id (FK)   │
│ threshold       │
│ rules (JSON)    │
│ is_active       │
│ created_at      │
└─────────────────┘
```

### 7.2 Fraud Entities

```
┌─────────────────┐       ┌─────────────────┐
│   FraudCase     │       │   FraudRule     │
├─────────────────┤       ├─────────────────┤
│ id              │       │ id              │
│ system_id (FK)  │       │ system_id (FK)  │
│ application_id  │       │ name            │
│ applicant_*     │       │ conditions      │
│ score           │       │ action          │
│ signals (JSON)  │       │ priority        │
│ status          │       │ is_active       │
│ queue_level     │       │ trigger_count   │
│ assigned_to     │       └─────────────────┘
│ sla_deadline    │
│ decision        │       ┌─────────────────┐
│ decided_at      │       │   FraudModel    │
└─────────────────┘       ├─────────────────┤
         │                │ id              │
         │ has many       │ system_id (FK)  │
         ▼                │ name            │
┌─────────────────┐       │ algorithm       │
│  Verification   │       │ status          │
├─────────────────┤       │ metrics (JSON)  │
│ id              │       │ is_active       │
│ case_id (FK)    │       └─────────────────┘
│ type            │
│ status          │       ┌─────────────────┐
│ result          │       │ SignalProvider  │
│ requested_at    │       ├─────────────────┤
│ completed_at    │       │ id              │
└─────────────────┘       │ system_id (FK)  │
                          │ name            │
                          │ provider_type   │
                          │ is_enabled      │
                          │ config (JSON)   │
                          └─────────────────┘
```

### 7.3 Decision Log

```
┌─────────────────────┐
│   DecisionRecord    │
├─────────────────────┤
│ id                  │
│ system_id (FK)      │
│ application_id      │
│ input_payload (JSON)│
│ score               │
│ decision            │
│ reason_codes        │
│ model_version_id    │
│ policy_version_id   │
│ latency_ms          │
│ timestamp           │
└─────────────────────┘
```

---

## 8. API Specifications

### 8.1 Authentication

All API requests require a Bearer token:

```
Authorization: Bearer <api_key>
```

API keys are scoped to a decision system and have permissions:
- `read`: View data
- `write`: Modify configuration
- `decide`: Request decisions

### 8.2 Endpoint Summary

| Method | Endpoint | Description |
|--------|----------|-------------|
| **Decision Systems** |||
| GET | /systems | List all systems |
| POST | /systems | Create system |
| GET | /systems/{id} | Get system |
| PATCH | /systems/{id} | Update system |
| DELETE | /systems/{id} | Delete system |
| **Datasets** |||
| GET | /systems/{id}/datasets | List datasets |
| POST | /systems/{id}/datasets | Upload dataset |
| GET | /systems/{id}/datasets/{id} | Get dataset |
| **Models** |||
| GET | /systems/{id}/models | List models |
| POST | /systems/{id}/models | Create model |
| POST | /systems/{id}/models/{id}/train | Start training |
| POST | /systems/{id}/models/{id}/activate | Activate model |
| **Policies** |||
| GET | /systems/{id}/policies | List policies |
| POST | /systems/{id}/policies | Create policy |
| POST | /systems/{id}/policies/{id}/activate | Activate policy |
| POST | /systems/{id}/policies/{id}/simulate | Simulate policy |
| **Decisions** |||
| POST | /systems/{id}/decide | Request decision |
| GET | /systems/{id}/decisions | List decisions |
| GET | /systems/{id}/decisions/{id} | Get decision |
| **Fraud** |||
| GET | /systems/{id}/fraud/cases | List fraud cases |
| GET | /systems/{id}/fraud/cases/{id} | Get case |
| POST | /systems/{id}/fraud/cases/{id}/decide | Decision case |
| POST | /systems/{id}/fraud/cases/{id}/verify | Request verification |
| GET | /systems/{id}/fraud/rules | List rules |
| POST | /systems/{id}/fraud/rules | Create rule |
| POST | /systems/{id}/fraud/rules/simulate | Simulate rule |
| GET | /systems/{id}/fraud/analytics | Get analytics |

### 8.3 Error Responses

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request body",
    "details": [
      {
        "field": "threshold",
        "message": "Must be between 0 and 1000"
      }
    ]
  }
}
```

**Error Codes**:
- `VALIDATION_ERROR` (400)
- `UNAUTHORIZED` (401)
- `FORBIDDEN` (403)
- `NOT_FOUND` (404)
- `RATE_LIMITED` (429)
- `INTERNAL_ERROR` (500)

---

## 9. Security & Compliance

### 9.1 Authentication & Authorization

- API key authentication for external integrations
- JWT tokens for console access
- Role-based access control (RBAC)
- Session timeout after inactivity

**Roles**:
| Role | Permissions |
|------|-------------|
| Admin | Full access |
| Risk Manager | Configure models, policies |
| Fraud Manager | Configure fraud rules, review cases |
| Analyst | Review cases, make decisions |
| Viewer | Read-only access |

### 9.2 Data Protection

- Encryption at rest (AES-256)
- Encryption in transit (TLS 1.3)
- PII masking in logs
- SSN stored as hash + last 4
- Data retention policies

### 9.3 Audit Logging

All actions are logged:
- User authentication events
- Configuration changes
- Decision requests/responses
- Data access

Log retention: 7 years (regulatory requirement)

### 9.4 Compliance

| Regulation | Requirement | Sentinel Feature |
|------------|-------------|------------------|
| FCRA | Adverse action notices | Reason codes |
| ECOA | Fair lending | Model monitoring, bias detection |
| GDPR | Data subject rights | Data export, deletion |
| SOC 2 | Security controls | Audit logs, access controls |
| PCI DSS | Payment data security | Encryption, access controls |

### 9.5 Model Governance

- Model documentation (model cards)
- Approval workflow for production deployment
- Ongoing performance monitoring
- Bias and fairness testing
- Model versioning and rollback

---

## 10. Non-Functional Requirements

### 10.1 Performance

| Metric | Target |
|--------|--------|
| Decision API latency (p50) | <50ms |
| Decision API latency (p95) | <100ms |
| Decision API latency (p99) | <200ms |
| Console page load | <2s |
| Dashboard refresh | <5s |

### 10.2 Availability

| Metric | Target |
|--------|--------|
| Uptime | 99.9% |
| Planned maintenance window | <4 hours/month |
| RTO (Recovery Time Objective) | <1 hour |
| RPO (Recovery Point Objective) | <5 minutes |

### 10.3 Scalability

| Metric | Target |
|--------|--------|
| Decisions per second | 1,000+ |
| Concurrent console users | 100+ |
| Dataset size | Up to 10M rows |
| Decision log storage | 1B+ records |

### 10.4 Reliability

- Automatic failover for database
- Circuit breakers for external services
- Graceful degradation when services unavailable
- Automated health checks

### 10.5 Observability

- Structured JSON logging
- Distributed tracing (OpenTelemetry)
- Metrics dashboards (Grafana)
- Alerting (PagerDuty)

---

## 11. Implementation Roadmap

### Phase 1: Foundation (MVP)
**Timeline: Weeks 1-6**

- [ ] Decision System CRUD
- [ ] Dataset upload and validation
- [ ] Basic model training (XGBoost)
- [ ] Policy configuration
- [ ] Decision API
- [ ] Basic console UI

**Deliverable**: Working end-to-end flow from data upload to decision serving

### Phase 2: Credit Risk
**Timeline: Weeks 7-10**

- [ ] Advanced model training (multiple algorithms)
- [ ] Model comparison and registry
- [ ] Decile analysis
- [ ] Policy simulation
- [ ] A/B testing infrastructure
- [ ] Enhanced dashboard

**Deliverable**: Production-ready credit risk decisioning

### Phase 3: Fraud Management
**Timeline: Weeks 11-16**

- [ ] Fraud scoring engine
- [ ] Case queue and assignment
- [ ] Investigation workflow
- [ ] Verification integrations
- [ ] Rule builder
- [ ] Fraud ML models
- [ ] Signal provider integrations

**Deliverable**: Complete fraud management module

### Phase 4: Exposure Control
**Timeline: Weeks 17-19**

- [ ] Limit configuration
- [ ] Real-time utilization tracking
- [ ] Alerts and notifications
- [ ] Segment analysis

**Deliverable**: Portfolio-level risk management

### Phase 5: Enterprise Features
**Timeline: Weeks 20-24**

- [ ] Advanced analytics and reporting
- [ ] Custom report builder
- [ ] Scheduled reports
- [ ] Webhook integrations
- [ ] SDKs (Python, JavaScript)
- [ ] Advanced RBAC
- [ ] SSO integration

**Deliverable**: Enterprise-ready platform

---

## 12. Success Metrics

### Business Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Time to first decision | <2 weeks | From signup to production |
| Customer retention | >90% | Annual renewal rate |
| NPS | >50 | Quarterly survey |
| Decision volume growth | 20% MoM | Platform-wide |

### Technical Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| API uptime | 99.9% | Monthly |
| Decision latency (p95) | <100ms | Continuous |
| Error rate | <0.1% | Continuous |
| Deployment frequency | Weekly | Per component |

### Customer Metrics

| Metric | Target | Measurement |
|--------|--------|-------------|
| Model AUC improvement | +5% | vs. customer baseline |
| Fraud loss reduction | -30% | vs. customer baseline |
| Analyst productivity | +50% | Cases per day |
| Time to policy change | <1 hour | vs. weeks with legacy |

---

## Appendix A: Glossary

| Term | Definition |
|------|------------|
| AUC | Area Under the ROC Curve; measure of model accuracy |
| Decile | 10% segment of population sorted by score |
| Gini | Statistical measure of model discriminatory power |
| KS | Kolmogorov-Smirnov statistic; model performance metric |
| Reason Code | Code explaining a factor in the decision |
| SLA | Service Level Agreement; target response time |
| Synthetic ID | Fabricated identity using real and fake information |

---

## Appendix B: Reason Code Library

| Code | Description |
|------|-------------|
| R001 | Strong credit history |
| R002 | Low debt-to-income ratio |
| R003 | Stable employment |
| R004 | High account age |
| D001 | Recent bankruptcy |
| D002 | High debt-to-income ratio |
| D003 | Insufficient credit history |
| D004 | Recent delinquencies |
| F001 | Device associated with fraud |
| F002 | Velocity rules triggered |
| F003 | Identity verification failed |
| F004 | Watchlist match |

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Feb 2026 | Product Team | Initial PRD |

---

*This document is the source of truth for Sentinel Decision Systems product requirements. All stakeholders should reference this document for feature specifications and acceptance criteria.*
