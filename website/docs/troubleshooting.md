# Troubleshooting

- `No config found`: add `.github/openreview.yml`.
- `unknown provider`: check `providers{}` keys match `main.provider` / `subagents[].provider`.
- Empty review: check `if_paths` / `defaults.ignore` and diff size (`max_diff_chars`).
- `Inline review failed`: non-fatal; sticky comment is source of truth (commit SHA or permission issue).
- No LLM output: verify secrets exist for the providers you reference.
