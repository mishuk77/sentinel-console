# Memory architecture — Credit Risk Analyst Agent

Three layers, each with a different lifetime and purpose. The agent
reads from all three; it writes to only two.

---

## Layer 1 — Run scratch

**Lifetime**: a single run.
**Location**: `runs/<timestamp>/`.
**Format**: structured JSON files + the markdown memo.
**Read by**: every skill in the run.
**Written by**: every skill in the run.

### Files in a run directory
- `profile.json` — output of `profile_data`.
- `decisions.jsonl` — append-only log; one JSON object per agent
  decision. Captures input, output, rationale, model used, timestamp.
- `api-calls.jsonl` — append-only log; one row per Sentinel API call,
  including method, path, status, latency, response digest.
- `system-config.json` — final state of what the agent built (or would
  build, in dry-run mode).
- `MEMO.md` — the deliverable.
- `errors.log` — any exception traces (usually empty).

### Why per-run scratch matters
- Reproducibility: same input + same versioned skills + same seeds
  → same memo, modulo LLM nondeterminism.
- Audit: a regulator can reconstruct any decision the agent made.
- Debug: when the memo is wrong, the trace shows which stage drifted.

The run scratch is **not** the source of cross-run learning. Lessons
from a given run, if any, are extracted into Layer 2 explicitly — never
read directly across runs.

---

## Layer 2 — Cross-run learnings

**Lifetime**: indefinite, scoped per environment (dev / staging / prod-
per-tenant).
**Location**: `~/.sentinel-agent/<env>/learnings.md` (local), or
`s3://sentinel-agent-memory/<env>/learnings.md` (later).
**Format**: human-readable markdown index, like `MEMORY.md` in
`~/.claude/`.
**Read by**: every L-skill at the start of its turn.
**Written by**: a dedicated `record_learning` skill, only when an
event meets the criteria below.

### What earns a learning entry

A learning is a *non-obvious, durable fact* that should change agent
behaviour next time. Three categories:

| Type | Trigger | Example |
|---|---|---|
| **Tenant data quirk** | Same dataset shape recurs and we noticed something off | "Acme's `loan_amount` is in cents, not dollars. Always divide by 100 before profiling." |
| **User preference (validated)** | User accepted or overrode a decision and stated a reason | "On this account, prefer 70%/8% over 80%/10% even when net yield is lower — risk appetite is conservative." |
| **Surprising interaction** | An assumption the agent held was demonstrably wrong | "Customer_status=NEW on this dataset has 3× the bad rate of EXISTING. Always segment on it." |

### What does NOT earn a learning entry

- Anything observable from the data on every run (the profiler will
  surface it). No memorising the schema.
- Anything in the codebase or API docs (the prompts will load it).
- Single-use overrides that don't generalise.
- Anything the agent figured out unaided this run — we'd duplicate the
  reasoning rather than encode the conclusion.

### Format

```markdown
# Cross-run learnings

## <env-or-tenant-name>

- [tenant-data] Acme's loan_amount is denominated in cents.
  Source: 2026-05-12 run #42. Confirmed by analyst.
- [preference] CRO prefers conservative posture (max loss 8%) over
  yield-maximising (max loss 10%). Source: 2026-05-15 review.
- [interaction] customer_status segment matters substantially on this
  portfolio (3x bad-rate gap). Source: 2026-05-09 run.
```

Each entry: tag, one-line statement, source pointer. Easy for an LLM
to skim at the top of every relevant stage.

---

## Layer 3 — Domain knowledge (preloaded)

**Lifetime**: indefinite, version-controlled with the codebase.
**Location**: `prompts/domain.md` (committed).
**Format**: markdown reference document.
**Read by**: every relevant L-skill via prompt injection.
**Written by**: humans via PR.

### What lives here

The agent's *priors* — things a credit analyst would know that aren't
in any specific dataset.

- **Industry baselines**: prime/near-prime/subprime expected loss
  ranges, FICO score distribution priors, credit-card vs unsecured
  vs auto vs HELOC default-rate norms.
- **Regulatory guardrails**: ECOA / FCRA / Reg B basics, state-by-state
  usury caps, NMLS basics, SR 11-7 model risk pillars.
- **Modelling norms**: what counts as "good" AUC for credit (>0.70
  baseline, >0.78 strong), KS interpretation bands, calibration error
  thresholds.
- **Common leakage patterns**: list of post-decision fields by name
  pattern, common feature names that are usually targets (`bad`, `gb`,
  `target`).
- **Constraint priors**: typical CRO posture (target approval 60–80%,
  loss tolerance 5–12%), typical product-by-product norms.

### Why this is separate from learnings

Domain knowledge is **always-on, always-correct**. It doesn't depend on
who the agent is talking to or what tenant it's running for. It's
basically a textbook excerpt. Versioning it in git is the right model.

---

## Memory access pattern (per-run)

```
START run
├── Load Layer 3 (domain.md)        — into agent context
├── Load Layer 2 (learnings.md)     — only entries tagged for this env
├── Initialise Layer 1 (run dir)    — empty
│
├── For each stage 1..9:
│     ├── Skill reads from Layer 1 (prior stage outputs)
│     ├── Skill reads from Layer 2/3 (priors)
│     ├── Skill produces output → writes Layer 1
│     └── Append to decisions.jsonl
│
├── compose_memo → MEMO.md          — Layer 1
├── (optionally) record_learning    — Layer 2
└── DONE
```

Layer 1 lives only inside the run directory. Layer 2 grows over time.
Layer 3 grows when humans add to it.

---

## Privacy and tenancy

When this becomes multi-tenant in production:

- Layer 1 is per-run, naturally tenant-scoped.
- Layer 2 must be **strictly tenant-scoped**. Acme's learnings never
  leak to Beta. The path layout enforces this:
  `s3://.../tenants/<tenant-id>/learnings.md`. Never a shared file.
- Layer 3 is global and contains no tenant data.
- The agent's prompt MUST include "do not reference tenant data outside
  the current tenant scope" as a rule, but the file structure is the
  primary defence.

---

## Open memory questions

1. **Lessons from negative outcomes** — when a memo turned out to be
   wrong (decisions diverged from reality), how does the agent know?
   Likely needs a feedback channel: when the user says "this memo was
   wrong because…" we record a learning.
2. **Drift in domain knowledge** — industry norms move (post-2020
   subprime is not pre-2020 subprime). Need a freshness label on
   Layer 3 entries.
3. **Cross-tenant learnings** — anonymised aggregate patterns might
   be valuable ("most fintechs we've seen target 70% approval"). But
   privacy & contractual concerns are real. Defer to product/legal.
4. **Memory compaction** — Layer 2 will grow. At some point the agent
   should compact (merge duplicate learnings, prune stale ones). MVP
   doesn't need this.
