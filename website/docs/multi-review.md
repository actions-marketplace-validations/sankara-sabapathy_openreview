# Multi-review + subagents + verdict

Define parallel `reviews[]`, each with `if_paths`, `main`, `subagents[]`, `verdict{mode,min_severity}`.

- Verdicts come from `main` synthesis filtered by `min_severity`; there is no cross-provider voting inside a review. (The per-review `strategy` key is accepted but currently ignored — see [issue #12](https://github.com/sankara-sabapathy/openreview/issues/12).)
- `global_verdict.strategy: any_blocking|majority` merges per-review verdicts.
- Output: sticky comment (marker `openreview:sticky`), inline `pulls.createReview` (max 20), `verdict` output.
