# Providers (BYOK)

No restricted set: **any** provider works with `protocol` + `base_url` + `key_from` + `model`.

- `protocol: openai-chat` (default) — OpenAI-compatible `/chat/completions`: OpenAI, Groq, Ollama, OpenRouter, DeepSeek, Mistral, xAI, Novita, OpenCode Zen/Go, … Override path with `endpoint_path`.
- `protocol: anthropic-messages` — Anthropic Messages API (`/v1/messages` default): Anthropic direct, or proxies exposing it.
- `kind:` (`anthropic|openai|opencode|openai-compatible`) is a deprecated shorthand that only sets protocol + default base URL. New configs should use `protocol`.
- `key_from: secrets.FOO` reads `$FOO` from the runner env — add any secret name, no code changes needed.
- `auth:` customizes the key header: Azure uses `{header: api-key, scheme: ""}`.
- `headers:` merges extra headers; `extra_body:` merges extra JSON body fields; `json_mode: false` drops `response_format` for providers that reject it.
- `opencode` (`kind: opencode`): Go subscription → `base_url: https://opencode.ai/zen/go/v1` with Go model IDs (`glm-5.3-flash`, `kimi-k2.7-code`, `deepseek-v4-flash`, … — no `opencode/` prefix). Zen pay-as-you-go → `base_url: https://opencode.ai/zen/v1` (`big-pickle`, …). Only `chat/completions` models supported. Full lists: [Go](https://opencode.ai/docs/go/) · [Zen](https://opencode.ai/docs/zen/). The action sends `User-Agent: OpenReview/*` + stable `x-opencode-session` per run as Go requires.

Missing key: agent skipped with warning; other providers continue. Fork PRs have no secrets by default — post guidance instead of failing.
