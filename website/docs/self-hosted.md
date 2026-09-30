# Self-hosted runners

OpenReview is runner-agnostic: it's a plain Node action, so `runs-on:` is entirely
your choice. No code changes needed — point the job at your machines.

## Minimal example (self-hosted label)

```yaml
jobs:
  review:
    runs-on: [self-hosted, linux] # your runner group / labels
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: sankara-sabapathy/openreview@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
        env:
          OPENCODE_API_KEY: ${{ secrets.OPENCODE_API_KEY }}
```

Same job works on ARC (Actions Runner Controller) scale sets — use your
`scale-set` name as the label:

```yaml
runs-on: arc-openreview-x64
```

## What the runner needs

- **Egress** to your providers' `base_url`s plus `api.github.com` (diff, comments,
  checks). Nothing else phones home.
- **Toolchain:** stock GitHub runners work as-is. Only extra need is `python3` if
  you later enable graph-based indexing (see issue #25); the review engine itself
  needs nothing beyond the runner.
- **Sizing:** two LLM calls run concurrently per review; a 2-CPU runner is plenty.
  The billable cost driver is provider tokens, not compute.

## Secrets hygiene (read this before fork PRs)

Secrets aren't exposed to fork PRs by default — that's GitHub protecting you. On
**persistent** self-hosted runners the risk is higher (a malicious PR could read
leftover workspace state), so:

- Never run untrusted fork diffs on persistent self-hosted runners.
- Prefer `pull_request_target` with an explicit pinned checkout, or gate reviews
  behind a maintainer-applied label, or use ephemeral (one-job) runners.

Verified matrix: `ubuntu-latest` ✅ (dogfood, every PR). Self-hosted/ARC: config
compatible, awaiting verification on a contributor runner — report yours in
[issue #24](https://github.com/sankara-sabapathy/openreview/issues/24).
