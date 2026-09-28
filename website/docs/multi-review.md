# Multi-review + subagents + verdict

Define parallel `reviews[]`, each with `if_paths`, `main`, `subagents[]`, `verdict{mode,min_severity}`.

```yaml
reviews:
  - id: security-strict # runs only on sensitive paths…
    if_paths: ["auth/**", "payments/**"]
    main:
      provider: codex
      instructions: "Staff security reviewer. OWASP, authz, injection. High-confidence only."
    verdict: { mode: request_changes, min_severity: high } # …and can block
  - id: general-quality # …while everything gets the general pass
    if_paths: ["**"]
    main:
      provider: go
      instructions: "Synthesize sub-agent findings."
    subagents:
      - { name: correctness, provider: go, instructions: "Bugs, races, missing tests." }
      - { name: perf, provider: go, instructions: "N+1 queries, hot loops." }
    verdict: { mode: comment, min_severity: medium }
global_verdict:
  strategy: any_blocking # one request_changes verdict decides the run
```

- Verdicts come from `main` synthesis filtered by `min_severity`; there is no cross-provider voting inside a review. (The per-review `strategy` key is accepted but currently ignored — see [issue #12](https://github.com/sankara-sabapathy/openreview/issues/12).)
- `global_verdict.strategy: any_blocking|majority` merges per-review verdicts.
- Output: sticky comment (marker `openreview:sticky`), inline `pulls.createReview` (max 20), `verdict` output.
