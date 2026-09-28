# Configuration (`openreview.yml`)

Resolution order: `.github/openreview.yml` > `.github/openreview.yaml` > `openreview.yml`.

Top-level: `version: 1` (schema version, required), `requires_action` (optional release floor, e.g. `">=0.3.0"`), `defaults`, `providers{}`, `reviews[]`, `global_verdict`.

Do NOT pin the action release in the yaml: the workflow ref (`uses: ...@v1`) selects the release — the yaml is read after download and can only validate, not select. `requires_action` fails fast with a clear message when the runner is older than the config needs; it is skipped when the running version can't be determined (floating refs like `@v1`).

Validate locally after `npm run build`: `node dist-src/validate.js .github/openreview.yml`.

See root `openreview.example.yml` and `schema/openreview.schema.json` as source of truth.
