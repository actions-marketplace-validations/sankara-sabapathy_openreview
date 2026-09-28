# Claude (Anthropic API)

Direct Anthropic access via the Messages API. Official docs: [Models overview](https://platform.claude.com/docs/en/models/overview) · [Pricing](https://platform.claude.com/docs/en/about-claude/pricing) · [API reference](https://platform.claude.com/docs/en/api/messages/create) · [Model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations). Check these links for the latest IDs — model names change fast.

## 1. Get a key

Create a key at [console.anthropic.com](https://console.anthropic.com/) → add it as a
repo secret (`ANTHROPIC_API_KEY`): repo **Settings → Secrets and variables → Actions → New repository secret**.

## 2. Configure

```yaml
providers:
  claude:
    protocol: anthropic-messages
    model: claude-sonnet-5 # see table below
    key_from: secrets.ANTHROPIC_API_KEY
reviews:
  - id: general
    main: { provider: claude, instructions: "Be strict on bugs, lenient on style." }
    subagents:
      - { name: correctness, provider: claude, instructions: "Bugs, races, missing tests." }
    verdict: { mode: comment }
```

OpenReview calls `POST https://api.anthropic.com/v1/messages` with an `x-api-key`
header — the standard Messages API shape, nothing custom.

## 3. Verify the key (optional)

```bash
curl https://api.anthropic.com/v1/messages \
  -H "content-type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -d '{"model":"claude-sonnet-5","max_tokens":10,"messages":[{"role":"user","content":"hi"}]}'
```

## Current models (checked 2026-09-28 — confirm via the links above)

| Model ID (API) | Best for review use | Context |
|---|---|---|
| `claude-sonnet-5` | **Recommended main reviewer** — best speed/intelligence blend | 1M tokens |
| `claude-opus-5-5` | Heaviest reviews (agentic coding); pricier | 1M tokens |
| `claude-haiku-4-5` | Cheap subagents (style, nits) | 200K tokens |
| `claude-fable-5-1` | Deep reasoning passes | 1M tokens |
| `claude-sonnet-4-5` | Legacy, still available | 200K tokens |

Alias IDs (e.g. `claude-sonnet-5`) are pinned snapshots from the 4.6 generation on.
Query [GET /v1/models](https://platform.claude.com/docs/en/api/models/list) for the
authoritative list your key can access.
