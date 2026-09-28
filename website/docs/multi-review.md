# Multi-review + subagents + verdict

Define parallel `reviews[]`, each with `if_paths`, `main`, `subagents[]`, `verdict{mode,min_severity}`.

- `strategy: any|all|majority` is reserved for future cross-provider voting inside one review (MVP runs all agents and lets `main` synthesize).
- `global_verdict.strategy: any_blocking|majority` merges per-review verdicts.
- Output: sticky comment (marker `openreview:sticky`), inline `pulls.createReview` (max 20), `verdict` output.
