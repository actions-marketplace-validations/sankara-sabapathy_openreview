# Custom / any other provider

Anything speaking OpenAI-compatible `chat/completions` or Anthropic `messages`
works with four fields. Official links per example are included — verify endpoints
there, they drift.

## Groq (fast open weights)

Docs: [Groq docs](https://console.groq.com/docs/overview) · [Models](https://console.groq.com/docs/models).

```yaml
providers:
  groq:
    protocol: openai-chat
    model: llama-3.3-70b-versatile
    base_url: https://api.groq.com/openai/v1
    key_from: secrets.GROQ_API_KEY
    json_mode: false # Groq rejects response_format on some models
```

## Ollama (local / self-hosted)

Docs: [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md). Reachable
only if the runner can see it (self-hosted runner or tunnel).

```yaml
providers:
  local:
    protocol: openai-chat
    model: qwen2.5-coder:32b
    base_url: http://host.docker.internal:11434/v1
    key_from: secrets.OLLAMA_API_KEY # any non-empty value; Ollama ignores it
    json_mode: false
```

## OpenRouter (many models, one key)

Docs: [OpenRouter docs](https://openrouter.ai/docs) · [Models](https://openrouter.ai/models).

```yaml
providers:
  router:
    protocol: openai-chat
    model: anthropic/claude-sonnet-5 # OpenRouter model slug
    base_url: https://openrouter.ai/api/v1
    key_from: secrets.OPENROUTER_API_KEY
    headers:
      HTTP-Referer: https://github.com/<you>/<repo>
      X-Title: OpenReview
```

## Azure OpenAI (deployment URLs + api-key auth)

Docs: [Azure OpenAI reference](https://learn.microsoft.com/en-us/azure/ai-foundry/openai/reference).

```yaml
providers:
  azure:
    protocol: openai-chat
    model: my-deployment
    base_url: https://RESOURCE.openai.azure.com/openai/deployments/my-deployment
    key_from: secrets.AZURE_OPENAI_KEY
    auth: { header: api-key, scheme: "" } # raw key, no Bearer
```

## Troubleshooting a new provider

1. Confirm the endpoint shape first with curl: does `POST {base}/chat/completions`
   (or the Anthropic path) accept your key and return `choices[0].message.content`?
2. If you get 400s about `response_format`, set `json_mode: false` (output parsing
   still works — it falls back to plain JSON extraction).
3. If all agents fail, OpenReview posts each agent's exact HTTP error in a details
   block on the PR — copy it, it names the problem.
