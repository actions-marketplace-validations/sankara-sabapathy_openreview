# Providers (BYOK)

- `claude` (`kind: anthropic`): `ANTHROPIC_API_KEY`, `model: claude-sonnet-4-5`.
- `codex` (`kind: openai`): `OPENAI_API_KEY`, `model: gpt-5-codex`.
- `opencode` (`kind: opencode`): `OPENCODE_API_KEY` + `base_url` (any OpenAI-compatible endpoint).

Missing key: agent skipped with warning; other providers continue. Fork PRs have no secrets by default — post guidance instead of failing.
