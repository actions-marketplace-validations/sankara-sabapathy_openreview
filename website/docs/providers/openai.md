# OpenAI (incl. Codex models)

OpenAI's Chat Completions API. Official docs: [All models](http://developers.openai.com/api/docs/models) · [List models API](https://developers.openai.com/api/reference/resources/models/methods/list) · [Pricing](https://developers.openai.com/api/docs/pricing). Check these links for the latest IDs.

## 1. Get a key

Create a key at [platform.openai.com/api-keys](https://platform.openai.com/api-keys) →
repo secret `OPENAI_API_KEY` (**Settings → Secrets and variables → Actions**).

## 2. Configure

```yaml
providers:
  codex:
    protocol: openai-chat
    model: gpt-5.3-codex # agentic coding model; see table
    base_url: https://api.openai.com/v1
    key_from: secrets.OPENAI_API_KEY
reviews:
  - id: security-strict
    if_paths: ["auth/**", "payments/**"]
    main:
      provider: codex
      instructions: "Staff security reviewer. OWASP, authz, injection. High-confidence findings only."
    verdict: { mode: request_changes, min_severity: high }
```

OpenReview calls `POST {base_url}/chat/completions` with `Authorization: Bearer` —
the standard shape. Note: subscription-only Codex models served over the
**Responses API** are *not* supported, only `chat/completions`-compatible IDs.

## 3. Verify the key (optional)

```bash
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY" | head -c 500
```

## Current coding models (checked 2026-09-28 — confirm via the links above)

| Model ID | Notes |
|---|---|
| `gpt-5.3-codex` | **Recommended reviewer** — most capable agentic coding model, chat-completions compatible |
| `gpt-5.5` / `gpt-5.5-pro` | Frontier coding + professional work |
| `gpt-5.4` / `gpt-5.4-mini` | Cheaper coding tiers |
| `gpt-5` / `gpt-5-mini` / `gpt-5-nano` | Budget ladder |
| `gpt-5-codex`, `gpt-5.1-codex`, `gpt-5.2-codex` | **Deprecated** — do not use in new configs |
