# Bug benchmark

A small, fixed set of PR diffs with known bugs, plus a runner that reviews them
with a real `openreview.yml` and scores the findings. Use it to see whether a
prompt, model, profile or context change makes the reviewer better or worse,
instead of judging from one dogfood PR.

## Run it

```sh
npm run build
OPENCODE_API_KEY=... npm run bench -- --out run.json --report report.md
```

The runner uses `.github/openreview.yml` by default (`--config` to pick
another). Keys come from the env var each provider's `key_from` names, exactly
as in the action. Every run spends real provider budget: 12 cases × the
config's agents.

Re-score a saved run without any API calls, for example with a different
severity floor or line tolerance:

```sh
npm run bench -- --replay run.json --min-severity medium --tolerance 1
```

Other flags: `--only id1,id2` runs a subset, `--cases <dir>` points at another
case set.

## What is measured

Each case is reviewed the way the action reviews a PR: `if_paths` scoping,
`defaults.ignore`, the cross-file context block (built from the case's
`after/` tree), dedupe and noise controls. Nothing is posted to GitHub.

A finding **matches** a seeded bug when it names the same file and either

- its line falls inside the bug's `lines` range, ± `--tolerance` (default 3), or
- it has no line at all and its comment contains one of the bug's `keywords`.

Findings are assigned to bugs by maximum matching, one finding per bug.

| term | meaning |
|---|---|
| TP | seeded bugs that some finding matched |
| FP | findings that match no seeded bug (every finding on a clean case) |
| FN | seeded bugs no finding matched |
| duplicates | extra findings on an already-credited bug; counted as neither TP nor FP |
| precision | TP / (TP + FP) |
| recall | TP / seeded bugs |

A case where an agent errored, was skipped for a missing key, or returned
unparseable output is flagged in the report: its misses say nothing about
review quality.

FP here means "not one of the seeded bugs". A reviewer can be right about
something the benchmark did not seed, so read the false-positive list before
treating precision as exact.

## Cases

| case | language | seeded bugs |
|---|---|---|
| `api-key-logged` | TS | bearer key written to a debug log |
| `cache-ttl-inverted` | TS | TTL comparison serves only expired entries |
| `config-loader-leak` | Python | file handle leaked on the error path; `int(None)` when an env var is unset |
| `date-month-index` | TS | 1-based month passed to `new Date` |
| `inverted-admin-check` | TS | admin middleware lets non-admins through |
| `missing-null-check` | TS | `null` from `getMany` dereferenced |
| `mutable-default-arg` | Python | shared `existing=[]` default |
| `pagination-off-by-one` | TS | page slice returns one extra item |
| `sql-injection` | TS | query param interpolated into SQL |
| `unawaited-async-check` | TS | async lockout check used without `await` |
| `clean-rename` | TS | none (false-positive control) |
| `clean-feature` | Python | none (false-positive control) |

## Add a case

1. Create `cases/<id>/before/` and `cases/<id>/after/` with the files as they
   are before and after the change. Keep it small and realistic; don't hint at
   the bug in names or comments.
2. Run `npm run bench:patches -- <id>` to write `cases/<id>/patch.diff`. Edit
   the sources, never the patch.
3. Write `cases/<id>/case.json`:

   ```json
   {
     "id": "<id>",
     "language": "TypeScript",
     "description": "What the PR claims to do.",
     "bugs": [
       {
         "id": "short-name",
         "file": "src/x.ts",
         "lines": [12, 13],
         "severity": "high",
         "summary": "What is wrong and why.",
         "keywords": ["words", "a correct comment would use"]
       }
     ]
   }
   ```

   `lines` are new-file line numbers and must sit inside a hunk of the patch;
   `severity` is `high` or `medium`. A clean case has `"bugs": []`.
4. `npm run build && npm test` checks every case: valid `case.json`, the bug's
   file is in the patch, every bug line is inside a hunk, and the file exists
   under `after/`.

`benchmark/cases/**` is in this repo's `defaults.ignore`, so the dogfood review
does not re-find the seeded bugs on every PR.
