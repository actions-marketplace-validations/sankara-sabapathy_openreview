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

## Subscription OAuth (Pro / Max / Team / Enterprise)

Use your Claude plan instead of API credits — the same pattern as the official
`claude-code-action`'s `claude_code_oauth_token`. Guide: [Claude Code
authentication](https://code.claude.com/docs/en/authentication) (see "Generate a
long-lived token").

### 1. Mint the token

On any machine with Claude Code installed and your subscription login:

```bash
claude setup-token
```

Approve in the browser, then copy the printed token (`sk-ant-oat01-…`, about 108
chars). It is valid for **one year** with no refresh — set a reminder to rotate it.
⚠️ Terminals wrap the output across lines: if you get 401s, first check you copied
the full untruncated value.

### 2. Store it as a secret

Repo **Settings → Secrets and variables → Actions** → `CLAUDE_CODE_OAUTH_TOKEN`.
Treat it like a password: it spends your subscription quota and acts as your account.

### 3. Pass it through the workflow and configure

`key_from` reads any runner env var, so expose the secret on the step (no new
action input needed):

```yaml
- uses: sankara-sabapathy/openreview@v1
  env:
    CLAUDE_CODE_OAUTH_TOKEN: ${{ secrets.CLAUDE_CODE_OAUTH_TOKEN }}
```

```yaml
providers:
  claude-subscription:
    protocol: anthropic-messages
    model: claude-sonnet-5
    key_from: secrets.CLAUDE_CODE_OAUTH_TOKEN
    auth: { header: Authorization, scheme: Bearer } # explicit = honored literally
    headers: { anthropic-beta: oauth-2025-04-20 }
```

OpenReview then calls the Messages API exactly the way Claude Code itself does.
Without the explicit `auth:` block, `x-api-key` is assumed (API-key behavior).

### Caveats

- Reviews consume your plan's usage allowance, not API credits.
- Never set `ANTHROPIC_API_KEY` alongside the OAuth token in one run — mixed
  credentials cause auth conflicts.
- Expired/invalid tokens surface as 401s in the PR's agent-error block; regenerate
  with `claude setup-token` and update the secret.
- ChatGPT/Codex subscription OAuth is **not** supported: Codex CLI talks to a
  proprietary backend, not an Anthropic/OpenAI-shaped API, so there is nothing
  stable to point `base_url` at.
