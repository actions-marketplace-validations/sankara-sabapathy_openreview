# OpenReview Backlog

Tracked issues that are accepted but not yet scheduled. Reference IDs as `OPENREVIEW-<n>`.

## OPENREVIEW-1: Per-review `strategy` voting is documented but not implemented

- **Status:** accepted / backlog
- **Area:** config schema, review engine (`src/main.ts`, `src/reviewer.ts`)
- **Found:** 2026-09-28 (dogfood review of v0.4.0 docs)

### Problem

Each entry in `reviews[]` accepts `strategy: any | all | majority`, and the README
previously described it as multi-provider voting. In reality `main.ts` never reads
`review.strategy`: every review runs all its agents, `main` synthesizes, and the
verdict comes from `verdict.mode` + `verdict.min_severity`. Only
`global_verdict.strategy` (across reviews) is honored. The field validates but is
silently ignored, and the docs overpromised it.

### Options

1. **Remove it (recommended).** Delete `strategy` from the per-review schema,
   `openreview.example.yml`, and docs. The main-synthesizer pattern already
   captures provider disagreement better than vote-counting severities, and it
   removes a dead knob. Migration is trivial (delete the key; default behavior
   is unchanged). Requires a minor release + changelog note, not a schema v2
   (additive-removal of an ignored field — still announce it).
2. **Implement it.** Run each provider's agents as an independent ballot inside
   one review and combine: `any` = one flag blocks, `all` = unanimous to block,
   `majority` = vote wins. Costs more LLM calls per PR and needs tie-break +
   severity-weighting rules.

### Acceptance criteria

- Either `strategy` is gone from schema/example/docs/JSON schema with zero
  references remaining, or per-review ballots are combined per the documented
  semantics and covered by a live dogfood PR showing a split vote.
- `website/docs/multi-review.md` no longer hedges; it states the actual behavior.
