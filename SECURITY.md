# Security

- BYOK keys stay in the consumer repo as GitHub Secrets; OpenReview never logs them (redacted, only passed as env to the runner).
- Fork PRs: secrets are unavailable by default. OpenReview skips LLM calls without keys and posts a guidance comment. Use `/review` from a maintainer after checking out the fork, or a `pull_request_target` workflow if you accept the risk.
- Report vulnerabilities via GitHub Security Advisories. No code is used for model training by OpenReview itself (provider policies apply).
