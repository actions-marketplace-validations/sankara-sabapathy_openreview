# Configuration (`openreview.yml`)

Resolution order: `.github/openreview.yml` > `.github/openreview.yaml` > `openreview.yml`.

Top-level: `version: 1`, `defaults`, `providers{}`, `reviews[]`, `global_verdict`.

Validate locally after `npm run build`: `node dist-src/validate.js .github/openreview.yml`.

See root `openreview.example.yml` and `schema/openreview.schema.json` as source of truth.
