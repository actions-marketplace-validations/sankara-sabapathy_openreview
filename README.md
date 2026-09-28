# OpenReview AI

Free, open-source, BYOK multi-provider multi-agent PR reviewer for GitHub.
([Marketplace listing](https://github.com/marketplace/actions/openreview-ai) ·
[Docs site](https://sankara-sabapathy.github.io/openreview/))

Configure with `.github/openreview.yml`. Runs as a GitHub Action in your repo — your
minutes, your keys. You pay your LLM provider directly, no per-seat SaaS.

- **Multi-review**: parallel `reviews[]`, each scoped by `if_paths` with its own verdict.
- **Any provider**: `protocol: openai-chat` (OpenAI, Groq, Ollama, OpenRouter, OpenCode
  Zen/Go, …) or `protocol: anthropic-messages`, with `base_url` + `key_from` + `model`.
  No restricted provider list; legacy `kind:` still works as a shorthand.
- **Main + subagents**: each review has a `main` synthesizer + custom `subagents[]`
  with their own instructions and providers.
- **Verdict**: `comment|approve|request_changes` per review, merged by
  `global_verdict` into a sticky PR comment + inline findings + `verdict` output.

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

2. Add secrets for the providers your config uses (any names work via `key_from`),
   e.g. `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `OPENCODE_API_KEY`.
3. Add `.github/openreview.yml` — copy [`openreview.example.yml`](./openreview.example.yml).
4. Open a PR. Re-review with a `/review` comment.

## Config

Full reference: [`openreview.example.yml`](./openreview.example.yml) + JSON Schema
[`schema/openreview.schema.json`](./schema/openreview.schema.json) + the
[docs site](https://sankara-sabapathy.github.io/openreview/).

Minimal (OpenCode Go subscription):

```yaml
version: 1
providers:
  go:
    protocol: openai-chat
    model: glm-5.3-flash
    base_url: https://opencode.ai/zen/go/v1
    key_from: secrets.OPENCODE_API_KEY
reviews:
  - id: general
    main: { provider: go, instructions: "Be strict on bugs, lenient on style." }
    subagents:
      - { name: correctness, provider: go, instructions: "Find bugs and races." }
    verdict: { mode: comment }
```

Top-level keys: `version: 1` (schema version, required), optional
`requires_action: ">=0.3.0"` (fails fast when the runner release is older than the
config needs — the workflow `uses:` ref selects the release, the yaml only sets a
floor), `defaults`, `providers{}`, `reviews[]`, `global_verdict`.

Known gap: per-review `strategy` is accepted but currently ignored — verdicts come
from `main` synthesis + `min_severity`. Tracked in [`BACKLOG.md`](./BACKLOG.md)
as OPENREVIEW-1.

## BYOK

Any provider with an OpenAI- or Anthropic-shaped HTTP API works via `protocol` +
`base_url` + `key_from` + `model`. Provider-specific knobs: `auth:` (e.g. Azure's
`{header: api-key, scheme: ""}`), `headers:`, `extra_body:`, `json_mode:`,
`endpoint_path:`. See the [providers doc](https://sankara-sabapathy.github.io/openreview/providers).

Missing key → that agent is skipped (warned in logs and, if all fail, in the PR
comment); other providers still run.

## Versioning

- Action: SemVer (`v0.4.0`, mutable `v0` + `v1` tags). Pin `@v1` for latest or
  `@v0.4.0` to freeze.
- Config: `version: 1`. Additive-only in v1.x. Breaking → `version: 2` with migration guide.
- Releases via `release-please` (Conventional Commits).

## Docs site

Docusaurus v3 in [`website/`](./website), deployed to GitHub Pages on every push
to `main`. See [website/README](./website/README.md).

## License

MIT. See [LICENSE](./LICENSE).
