# OpenCode Zen (pay-as-you-go)

Zen is OpenCode's tested-model gateway billed per token. Official docs: [Zen](https://opencode.ai/docs/zen/) · [Console / billing](https://opencode.ai/auth). Prices and the model list change — the Zen page is authoritative.

## 1. Get a key

Sign in at [opencode.ai/auth](https://opencode.ai/auth), add billing, copy the key →
repo secret `OPENCODE_API_KEY`. (Free-tier keys only work **inside OpenCode itself**
and return `FreeTierError` over raw API — use a funded key.)

## 2. Configure

```yaml
providers:
  zen:
    protocol: openai-chat
    model: big-pickle # free for a limited time; see table
    base_url: https://opencode.ai/zen/v1
    key_from: secrets.OPENCODE_API_KEY
```

Same headers as Go (`User-Agent`, per-run `x-opencode-session`). Only
`chat/completions`-listed models work through OpenReview; Zen rows served over
`/responses`, `/messages`, or `/models/<name>` endpoints do not.

## Zen models on `chat/completions` (checked 2026-09-28)

| Model ID | Price (per 1M in/out) |
|---|---|
| `big-pickle` | Free (limited time) — **recommended to try** |
| `kimi-k2.7-code`, `kimi-k2.6`, `kimi-k3` | $0.95–3.00 / $4.00–15.00 |
| `deepseek-v4-flash` | $0.14 / $0.28 |
| `deepseek-v4-pro` | $1.74 / $3.48 |
| `glm-5.3` / `glm-5.3-flash` | $1.40 / $4.40 · $0.15 / $0.50 |
| `qwen3.8-max` | $2.00 / $6.00 |
| `muse-spark-1.3-contributor-free` | Free (trains on your data — see Zen privacy table) |
| `space-bunny-free`, `longcat-2.5-preview-free`, `mimo-*-free`, `ling-*`, `nemotron-*` | Free (limited time) |

Full model list programmatically: `GET https://opencode.ai/zen/v1/models`.
