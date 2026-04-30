# Sentinel Credit Risk Analyst Agent — Plan

**Status:** planning only. No implementation yet.
**Owner:** mishuk77
**Drafted:** 2026-04-29 (revisit week of 2026-05-06)

---

## 1. Why this exists

The QA walker (`sentinel-qa/`) deterministically *executes* the demo flow.
The Risk Analyst Agent *reasons* about the same flow, makes choices a
human analyst would, and writes a memo defending those choices.

Same surface (Sentinel API), different posture: walker confirms a system
works; agent decides what the system *should be*.

**The deliverable is the memo, not the configured system.** Every CRO has
seen a configured system. Almost none have seen a defensible one-pager
explaining why every cutoff, segment, and ladder rung is set the way it
is, with citations to the data. That memo is the moat.

### Customers

| Persona | Pain | What the agent gives them |
|---|---|---|
| Fintech CRO standing up a new product | 4–6 weeks to build a policy, longer to defend it to the board | Day-1 system + a memo that is the board deck |
| Regional bank entering a new geography | Need a defensible model risk file fast | SR 11-7-aligned narrative + auditable trace |
| Existing customer rolling a new model | Calibration tuning is intuition, hard to justify | Operating-point analysis with explicit tradeoffs |

---

## 2. What the agent does (end-to-end)

Input: a CSV file (or a `dataset_id` already on Sentinel) plus business
constraints (target approval rate, max acceptable loss, etc.) — both
defaulted from priors if absent.

Output:
1. A configured Sentinel system (when `--apply` is set), and
2. A markdown **memo** explaining every decision.

### Stages

The agent runs nine ordered stages. Each produces a structured output
plus a section of the memo.

| # | Stage | LLM reasoning | Deterministic |
|---|---|---|---|
| 1 | **Profile data** — types, ranges, missingness, cardinality, candidate IDs/targets/amounts | light | heavy |
| 2 | **Choose target** — confirm binary outcome, base rate, class imbalance posture | medium | light |
| 3 | **Choose features** — exclude leakage / PII / post-decision fields, flag correlations, reason about IV | heavy | medium |
| 4 | **Train models** — kick off training via Sentinel API, poll until done | none | heavy (delegate to walker) |
| 5 | **Pick model** — composite score (AUC + KS + calibration + simplicity), explain | medium | medium |
| 6 | **Recommend policy** — find operating points, apply business constraints, defend cutoff | heavy | medium |
| 7 | **Recommend segments** — find slices where conditional risk meaningfully differs from global, only when n is sufficient | heavy | medium |
| 8 | **Recommend amount ladder** — risk × amount cross-tab, monotone EL-optimal ladder | medium | heavy |
| 9 | **Risk & compliance review** — stress test, disparate impact (when proxy cols exist), concentration, drift posture | heavy | medium |

After stage 9, the agent assembles the memo and (if `--apply`) writes
the system to Sentinel via the existing API surface.

---

## 3. Architecture at a glance

```
sentinel-risk-agent/
├── PLAN.md            ← this file
├── skills.md          ← inventory of discrete capabilities
├── memory.md          ← what persists, where, why
├── README.md          ← run-it pointer
├── prompts/           ← (later) system prompts per stage
├── tools/             ← (later) tool implementations
├── runs/              ← per-run artifacts (gitignored)
│   └── <ts>/
│       ├── MEMO.md           ← the headline deliverable
│       ├── profile.json
│       ├── decisions.jsonl   ← every reasoning trace
│       ├── api-calls.jsonl   ← every Sentinel API call
│       └── system-config.json ← final state of what got built
└── src/               ← (later) agent code
```

### Runtime

- **Orchestrator**: Claude Agent SDK (Python). One top-level agent that
  drives the nine stages.
- **Sub-agents / skills**: each stage is a focused sub-agent or a tool
  call. See `skills.md`.
- **Sentinel I/O**: reuse `sentinel-qa/walker.py`'s build-flow steps as
  callable tools. The walker already knows how to authenticate, upload,
  annotate, train, publish, calibrate, and ladder. Don't re-implement
  any of that — wrap it.
- **Reasoning model**: Opus for stages 3, 6, 7, 9 (judgment-heavy).
  Sonnet/Haiku for stages 1, 2, 5, 8 (more mechanical).
- **Determinism**: every random choice gets a seed in the run config;
  the same input produces the same memo modulo LLM nondeterminism.

### Modes

| Flag | Behaviour |
|---|---|
| `--dry-run` (default) | Reason about everything, produce the memo, do NOT write to Sentinel |
| `--apply` | Same reasoning, then actually publish the policy / segments / ladder |
| `--memo-only` | Reason but skip even read-only API mutations (e.g., for replaying old runs) |
| `--review-checkpoints` | Pause for human approval after each stage |

The default is dry-run. **Apply is opt-in** to keep the agent from
mutating production state until a human has read the memo.

---

## 4. The memo (the headline deliverable)

This is the artifact the customer pays for. Drafting the structure now so
we can prompt the agent against it.

```
# Credit Risk Policy Memo — <dataset name>
Generated by Sentinel Risk Analyst Agent at <timestamp> · run_id <id>

## Executive summary
- Built decision system for <dataset>, n=<rows>, base default rate=<X%>
- Recommended policy: approve <Y%> of applicants at score cutoff <Z>
  - Expected approval rate: <Y%>
  - Expected loss rate (count): <X%>
  - Expected loss rate (dollars): <X%>
  - Net risk-adjusted yield: $<W>M
- Headline tradeoffs:
  - Chose <model> over <runner-up>: <one-line reason>
  - Chose decile-<N> cutoff over decile-<N±1>: <one-line reason>
  - Created <K> segments — none more granular than X because <reason>
- Three things I want a human to verify (see §10):
  1. ...
  2. ...
  3. ...

## 1. Data profile
- Rows / columns
- Per-column: type, missingness, cardinality, range
- Suspect columns: <list with rationale>

## 2. Target selection
- Chose `<col>` because <reasons + counter-arguments addressed>
- Base rate: X%. Class balance posture: <imbalanced/balanced + implication>

## 3. Feature decisions
| Feature | Decision | Rationale |
|---|---|---|
| <col> | INCLUDED | <IV, monotonicity, missingness OK> |
| <col> | EXCLUDED | <leakage / PII / post-decision / collinearity> |

Two features I was on the fence about: <list, with the deciding factor>

## 4. Model selection
- Trained: <list of algos>
- AUC by model: <table>
- KS / Brier / calibration: <table>
- Picked <model> by composite score: <reasoning>
- The reason it's not <runner-up>: <reasoning>
- Concerns about the chosen model: <list>

## 5. Recommended policy
- Cutoff: score < <X>, decile <N>, projected approval <Y%>
- Why this cutoff: <reasoning grounded in business constraints>
- Alternative operating points considered:
  | Decile | Approval | Loss rate | Net $ | Reason rejected |
  |---|---|---|---|---|

## 6. Segmentation strategy
- Created segments: <list>
- For each: n_samples, base default rate, recommended threshold, rationale
- Segments I considered and rejected: <list with reason — usually n too small>
- Lift estimate from segmentation: <X pp loss-rate reduction>

## 7. Amount ladder
| Decile | Recommended max | Bad rate observed | Reason |
|---|---|---|---|
- Why monotone-decreasing: <expected-loss minimisation argument>
- Estimated EL reduction vs flat ladder: $<X>

## 8. Risk considerations
- Stress test 1 — base rate +20%: <impact>
- Stress test 2 — top-decile concentration: <impact>
- Disparate impact (where demographic proxies exist): <ratios per class>
- Concept drift posture: <recommendation for retraining cadence>

## 9. Open risks I am NOT addressing
- <list — things outside agent scope, e.g., macro outlook, competitive pricing>

## 10. Human review checklist
- [ ] Confirm target column matches business definition of "loss"
- [ ] Spot-check 5 random declines and 5 random approvals
- [ ] Validate disparate-impact mitigation if any group ratio < 0.8
- [ ] Confirm amount ladder respects regulatory caps in your geography
- [ ] ...

## Appendix: full audit trail
- Every API call: see `api-calls.jsonl`
- Every reasoning decision: see `decisions.jsonl`
- Final system configuration: see `system-config.json`
```

The "things I want a human to verify" callout is critical — it
positions the agent as a partner that knows its limits, not a black box.

---

## 5. Skills inventory

Lives in `skills.md` (companion file). Each skill is a discrete
capability with a defined input/output contract.

Buckets:
- **Data understanding**: `profile_data`, `detect_target`,
  `detect_amount_column`, `detect_segmenting_columns`, `flag_leakage`,
  `score_feature_quality`
- **Model selection**: `train_models` (delegates to walker),
  `compare_models`, `find_operating_points`
- **Policy reasoning**: `apply_business_constraints`,
  `recommend_cutoff`, `discover_segments`, `build_amount_ladder`
- **Risk review**: `stress_test_policy`, `disparate_impact_check`,
  `concentration_check`, `drift_posture`
- **Output**: `write_memo_section`, `compose_memo`,
  `produce_audit_trail`

---

## 6. Memory

Lives in `memory.md` (companion file). Three layers:

1. **Run scratch** — per-run state, kept in `runs/<ts>/`. Discarded
   after the memo is composed (except artifacts).
2. **Cross-run learnings** — lessons accumulated across runs in this
   environment. E.g., "this customer's `loan_amount` is denominated in
   cents not dollars." Stored under `~/.sentinel-agent/<env>/learnings.md`.
3. **Domain knowledge (preloaded)** — checked-in baseline knowledge
   the agent always has access to. E.g., subprime expected loss bands,
   FICO distribution priors, regulatory guardrails per US state. Stored
   under `prompts/domain.md`.

---

## 7. Phased build

### Phase 1 — MVP (1 week of work)
- Single-shot dry-run end-to-end
- Hardcoded for `loan_data_30k.csv` schema (same as walker build flow)
- All 9 stages produce *something*, even if rough
- Memo composes from stage outputs
- No `--apply` yet
- **Goal: have a memo we can show a CRO**

### Phase 2 — Production-grade (2 weeks)
- `--apply` mode wired through the walker's build flow
- Generic schema detection (works on any reasonable CSV, not just the demo file)
- Cross-run learnings stored
- `--review-checkpoints` for human-in-the-loop
- Disparate impact check when demographic proxy columns are present
- Stress tests parameterised by macro scenario

### Phase 3 — Productisation (4+ weeks)
- Run from the Sentinel UI ("Build me a system from this file" button)
- Memo viewable in-app with anchor links to actual UI screens
- Slack / email memo delivery
- Multi-tenant memory (per-client learnings stay isolated)
- Versioned memos (re-run with new data, see what changed)

---

## 8. Open questions to resolve next week

1. **Agent SDK or roll our own?** Claude Agent SDK gives us tool calling
   and sub-agents out of the box. Rolling our own gives full control.
   Lean SDK for speed-to-MVP.
2. **Where does the agent run?** Local CLI for MVP. Eventually a
   server-side worker on Railway with WebSocket progress to the UI.
3. **What's the human approval flow?** Email a draft memo + a link
   that lands the user on a checkpoint page in Sentinel? Or pure CLI
   gating with prompts? CLI for now.
4. **Memo format — markdown vs PDF vs in-app?** Markdown source of
   truth. PDF rendered on demand. In-app view post-MVP.
5. **Which LLM for which stage?** Defaulting to Opus for stages 3/6/7/9,
   Sonnet for the rest. May need to revisit after we see real outputs.
6. **How does it handle truly bad data?** (mostly missing target, no
   loan amount column at all, all features constant, etc.) — need an
   `agent.exit_with_diagnosis` flow for unrunnable inputs.
7. **Do we surface uncertainty?** Should the memo say "I am 70%
   confident in the cutoff because…"? Likely yes, but how to derive the
   number?
8. **Do we automate Phase 4 — the explainer for declined applicants
   (FCRA adverse action notices)?** Adjacent product, possibly bigger
   wedge for compliance buyers. Probably a separate agent that uses
   the same skills.
9. **Pricing**: per-run? per-system? per-memo? — out of scope for the
   plan, but worth flagging.

---

## 9. Success criteria

We'll know the MVP is real when:

- We can hand the memo to a friendly CRO and they say "yeah, this is
  what my analyst would have written, but in 1/100th the time" without
  hedging.
- The memo correctly identifies at least one non-obvious thing about
  the data (a leakage feature, an underweighted segment, a misnamed
  target) on the demo dataset.
- A regulator reading the memo cold can answer "why was applicant X
  declined?" using only the memo + the audit trail.
- The configured system passes the QA walker's full sweep (P0=0).
  This is the closing assertion: agent built it, walker verifies it.

---

## 10. Relationship to other Sentinel components

- **`sentinel-qa/walker.py`** — the agent's *deterministic shell*. The
  build-flow steps in walker (create_system → upload → annotate →
  train → activate → publish → segment → calibrate → ladder) are the
  exact actions the agent takes. We import or directly reuse those
  functions; the agent's job is to decide what *parameters* to pass.
- **`backend/`** — unchanged for MVP. The agent talks to the same API
  the frontend talks to. If the API is missing something the agent
  needs (e.g., univariate IV stats), that's a backend feature request,
  not a workaround.
- **`frontend/`** — unchanged for MVP. Phase 3 adds a "Build me a
  system" entry point that kicks off the agent and streams its memo
  back live.

---

*End of plan.*
