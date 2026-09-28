# Contributing

- Use Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`). Releases are automated with release-please.
- `npm run typecheck && npm run build && node dist-src/validate.js openreview.example.yml`
- Update `openreview.example.yml` + `schema/openreview.schema.json` + `website/docs/*` together.
- Config changes in v1 must be additive-only.
