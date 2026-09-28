# Providers (BYOK)

- `claude` (`kind: anthropic`): `ANTHROPIC_API_KEY`, `model: claude-sonnet-4-5`.
- `codex` (`kind: openai`): `OPENAI_API_KEY`, `model: gpt-5-codex`.
- `opencode` (`kind: opencode`): `OPENCODE_API_KEY`. Go subscription → `base_url: https://opencode.ai/zen/go/v1` with Go model IDs (`glm-5.3-flash`, `kimi-k2.7-code`, `deepseek-v4-flash`, … — no `opencode/` prefix). Zen pay-as-you-go → `base_url: https://opencode.ai/zen/v1` (`big-pickle`, …). Only `chat/completions` models supported. Full lists: [Go](https://opencode.ai/docs/go/) · [Zen](https://opencode.ai/docs/zen/). The action sends `User-Agent: OpenReview/*` + stable `x-opencode-session` per run as Go requires.

Missing key: agent skipped with warning; other providers continue. Fork PRs have no secrets by default — post guidance instead of failing.
