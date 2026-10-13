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

- **`main` synthesizes** (`main_mode: synthesize`, the default). Subagents
  review first; `main` then gets the diff plus their findings (each with an id)
  and returns the final list: duplicates merged, false positives dismissed with
  a reason, issues the others missed added. It also writes a **PR summary** and a
  per-file **walkthrough**, both shown on the sticky under the verdict, with a
  collapsed list of what it dismissed and why. It is fail-safe: a subagent
  finding the synthesizer never mentions is kept as reported, and if the
  synthesizer fails (error, unusable reply, run budget spent) the review falls
  back to the plain union of subagent findings and is floored like any partial
  review. The cost is latency: `main` waits for the slowest subagent. Set
  `main_mode: parallel` to run `main` alongside the subagents as one more
  reviewer (the behavior before 0.13), with no summary or walkthrough.
- Each distinct provider used by a review's agents casts one **ballot**: its own
  verdict over its own findings (`mode` + `min_severity`). `strategy` combines them:
  `any` = most severe ballot wins, `all` = unanimous to escalate, `majority` =
  median ballot (even-count ties break toward more severe). Single-provider reviews
  behave identically under all three. A finding the synthesizer merged from
  several agents counts in each source provider's ballot; one it added itself
  counts under `main`'s provider; a dismissed one counts nowhere.
- **`if_paths` scopes the diff, not just the trigger.** A review only receives
  patches for files matching its own `if_paths`, and its prompt ends with a note
  saying how many of the in-scope files were withheld:

  ```
  # OpenReview scope note: 2 of 9 in-scope changed file(s) are included,
  # matched against if_paths. 7 omitted. Judge only the files above.
  ```

  So in the example above the `security-strict` review never sees (and never
  spends tokens on) `website/` changes, and cannot file a finding about them.
  Cross-file context (`context_files`, call-site excerpts) is still built from the
  whole repo — that is what makes a finding on `auth/**` able to cite a caller in
  `lib/`.
- `global_verdict.strategy: any_blocking|majority` merges per-review verdicts.
- Output: sticky comment (marker `openreview:sticky`), inline `pulls.createReview` (max 20, pre-validated against the diff — bogus paths/lines are dropped and counted on the sticky instead of 422ing the batch; file-level notes ride in the review body), `verdict` output. `verdict.post_inline: false` opts a review out of inline comments. `global_verdict.sticky_comment_mode: append` keeps a per-run history in the sticky (head SHA + verdict + run link per section, rotates past ~60KB) instead of replacing it.
- Every run appends usage footers to the sticky (`Models: <model> <in>/<out> <tok/s> …`, summed per model, plus an `Agents:` line with each agent's own spend and attempt count). Token counts accumulate across all attempts — a retried attempt still billed — and model throughput divides by wall-clock elapsed, not summed durations. Providers that omit `usage` render as `?/?` (unknown, never zero); a model total covering only some agents carries a `+` partial marker.
