# OpenReview

Free, open-source, BYOK multi-provider multi-agent PR reviewer for GitHub.

Configure with `.github/openreview.yml`. Runs as a GitHub Action in your repo. You pay your LLM provider directly — no per-seat SaaS.

- **Multi-review**: define parallel `reviews[]`, each scoped by `if_paths`.
- **Multi-provider**: `claude` (Anthropic) + `codex` (OpenAI) + `opencode` (OpenAI-compatible) in one run, with `any|all|majority` strategy.
- **Main + subagents**: each review has a `main` synthesizer + custom `subagents[]` with own instructions.
- **Verdict**: `comment|approve|request_changes` per review + `global_verdict` with sticky comment + inline findings.

## Quickstart (60s)

1. Copy the workflow:

```yaml
# .github/workflows/openreview.yml
name: OpenReview
on:
  pull_request:
    types: [opened, synchronize, reopened, ready_for_review]
  issue_comment:
    types: [created]
permissions:
  pull-requests: write
  issues: write
  contents: read
jobs:
  review:
    if: github.event_name == 'pull_request' || (github.event.issue.pull_request && contains(github.event.comment.body, '/review'))
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: sankara-sabapathy/openreview@v1
        with:
          github-token: ${{ secrets.GITHUB_TOKEN }}
          anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
          opencode-api-key: ${{ secrets.OPENCODE_API_KEY }}
```

2. Add secrets: `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY` (only the ones you use).
3. Add `.github/openreview.yml` — copy [`openreview.example.yml`](./openreview.example.yml).
4. Open a PR. Re-review with `/review` comment.

## Config

Full reference: [`openreview.example.yml`](./openreview.example.yml) + JSON Schema [`schema/openreview.schema.json`](./schema/openreview.schema.json) + docs site in [`website/`](./website).

Minimal:

```yaml
version: 1
providers:
  claude: { kind: anthropic, model: claude-sonnet-4-5, key_from: secrets.ANTHROPIC_API_KEY }
reviews:
  - id: general
    main: { provider: claude, instructions: "Be strict on bugs, lenient on style." }
    subagents:
      - { name: correctness, provider: claude, instructions: "Find bugs and races." }
    verdict: { mode: comment }
```

## BYOK

| Provider key | Secret | Notes |
|---|---|---|
| Claude | `ANTHROPIC_API_KEY` | Anthropic Messages API |
| Codex | `OPENAI_API_KEY` | OpenAI Chat Completions |
| OpenCode | `OPENCODE_API_KEY` + `OPENCODE_BASE_URL` | Any OpenAI-compatible endpoint |

Missing key → that agent is skipped (warned in logs), other providers still run.

## Versioning

- Action: SemVer (`v1.2.3`, mutable `v1`). Pin `@v1` for auto-minor or `@v1.2.3` to freeze.
- Config: `version: 1`. Additive-only in v1.x. Breaking → `version: 2` with migration guide.
- Releases via `release-please` (Conventional Commits).

## Docs site

`website/` is a Docusaurus v3 site. See [website/README](./website/README.md).

## License

MIT. See [LICENSE](./LICENSE).
