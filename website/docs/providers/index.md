# Providers overview

Any provider with an OpenAI- or Anthropic-shaped HTTP API works. Pick a page:

- [Claude (Anthropic direct)](./claude) — `protocol: anthropic-messages`
- [OpenAI (incl. Codex models)](./openai) — `protocol: openai-chat`
- [OpenCode Go ($10/mo subscription)](./opencode-go) — `protocol: openai-chat`, `zen/go/v1`
- [OpenCode Zen (pay-as-you-go)](./opencode-zen) — `protocol: openai-chat`, `zen/v1`
- [Custom / any other](./custom) — Groq, Ollama, OpenRouter, Azure, Bedrock-proxy, …

## Minimal wiring (all providers)

```yaml
providers:
  mine:
    protocol: openai-chat # or anthropic-messages
    model: <model-id>
    base_url: https://<provider-host>/v1
    key_from: secrets.MY_API_KEY # any $NAME works; add it as a repo Actions secret
```

Pass the secret through the workflow so the runner can see it:

```yaml
- uses: sankara-sabapathy/openreview@v1
  with:
    github-token: ${{ secrets.GITHUB_TOKEN }}
    openai-api-key: ${{ secrets.OPENAI_API_KEY }}     # legacy fixed inputs
    anthropic-api-key: ${{ secrets.ANTHROPIC_API_KEY }} # still work,
    opencode-api-key: ${{ secrets.OPENCODE_API_KEY }}   # key_from: is preferred for new providers
```

`key_from: secrets.FOO` reads `$FOO` from the runner environment — no code changes
needed for new providers. Missing key → that agent is skipped (warning in logs;
if every agent fails the sticky comment shows an error block), others still run.

## Provider-specific knobs

```yaml
providers:
  azure:
    protocol: openai-chat
    model: my-deployment
    base_url: https://RESOURCE.openai.azure.com/openai/deployments/my-deployment
    key_from: secrets.AZURE_OPENAI_KEY
    auth: { header: api-key, scheme: "" } # Azure style: raw key, no Bearer
    headers: { X-Extra: value }           # merged into every request
    endpoint_path: /chat/completions      # default per protocol
    json_mode: false                      # drop response_format for strict providers
    extra_body: { temperature: 0.1 }      # merged into the JSON body
```

`kind:` (`anthropic|openai|opencode|openai-compatible`) is a deprecated shorthand
that only sets protocol + default base URL. New configs should use `protocol`.

## Disclaimer

**OpenReview is MIT-licensed software provided as-is.** You bring your own API keys,
pay your providers directly, and own everything that happens in your repositories:
review output is AI-generated and can be wrong — always have a human review before
merging. The maintainers accept no responsibility for provider charges, exposed
secrets, or code merged on AI advice.
