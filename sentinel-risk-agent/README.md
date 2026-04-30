# Sentinel Credit Risk Analyst Agent

> An agent that takes a raw application file, builds a complete decision
> system, and writes a memo defending every choice it made.

**Status**: planning only. Implementation begins week of 2026-05-06.

## Read these in order

1. **[PLAN.md](PLAN.md)** — vision, architecture, phased build, the
   memo format. The main planning doc.
2. **[skills.md](skills.md)** — discrete capabilities the agent
   composes from.
3. **[memory.md](memory.md)** — three-layer persistence model
   (run scratch, cross-run learnings, domain knowledge).

## Why this exists

The QA walker (`../sentinel-qa/`) is a deterministic test harness.
The Risk Analyst Agent uses the same Sentinel API surface but adds
*reasoning* on top: it decides what the system *should* be, not just
whether it *works*.

The deliverable is the **memo** — a defensible one-pager that explains
every cutoff, segment, and ladder rung. That's the moat.

## Relationship to the QA walker

The walker's `build.*` steps (create_system, upload_dataset, train,
publish_policy, calibrate, save_ladder) are exactly the actions the
agent takes. The agent's job is to decide what *parameters* to pass.
We import or directly reuse those functions; we don't rebuild the API
plumbing.

## Folder layout (planned)

```
sentinel-risk-agent/
├── PLAN.md            ← THIS IS THE MAIN DOC
├── skills.md
├── memory.md
├── README.md          ← you are here
├── prompts/           ← (later) per-stage system prompts + domain.md
├── tools/             ← (later) tool implementations
├── runs/              ← (later, gitignored) per-run artifacts
└── src/               ← (later) agent code
```

## Open the conversation

Next session: pick up from PLAN.md §8 (open questions to resolve), then
PLAN.md §7 (phased build) for Phase 1 MVP scope.
