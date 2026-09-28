import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as YAML from "yaml";
import { parseConfig } from "./config.js";
import { resolveKeysFromEnv, runAgent, type Finding } from "./providers.js";
import {
  matchesAny, filterIgnored, dedupeFindings,
  decideReviewVerdict, combineVerdicts, type Verdict,
} from "./reviewer.js";
import { renderStickyBody, upsertStickyComment, createInlineReview } from "./github.js";

const CONFIG_CANDIDATES = [
  ".github/openreview.yml",
  ".github/openreview.yaml",
  "openreview.yml",
  "openreview.yaml",
];

async function loadConfig(configPath: string) {
  const candidates = [configPath, ...CONFIG_CANDIDATES.filter((c) => c !== configPath)];
  for (const p of candidates) {
    if (!existsSync(p)) continue;
    const raw = YAML.parse(await readFile(p, "utf8"));
    return { config: parseConfig(raw), path: p };
  }
  throw new Error(
    `No config found. Tried: ${candidates.join(", ")}. Add .github/openreview.yml (see openreview.example.yml).`
  );
}

async function getPrDiff(octokit: ReturnType<typeof github.getOctokit>, owner: string, repo: string, pr: number) {
  const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo, pull_number: pr, per_page: 100 });
  const parts: string[] = [];
  const names: string[] = [];
  for (const f of files) {
    names.push(f.filename);
    if (f.patch) parts.push(`--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`);
  }
  const { data: pull } = await octokit.rest.pulls.get({ owner, repo, pull_number: pr });
  return { fileNames: names, diff: parts.join("\n\n"), headSha: pull.head.sha };
}

export async function run(): Promise<void> {
  try {
    const token = process.env["INPUT_GITHUB-TOKEN"] || process.env.GITHUB_TOKEN || "";
    if (!token) throw new Error("Missing github-token (GITHUB_TOKEN).");
    const octokit = github.getOctokit(token);
    const ctx = github.context;
    const prNumber = ctx.payload.pull_request?.number ?? Number(process.env.PR_NUMBER ?? 0);
    if (!prNumber) {
      core.warning("No pull_request context; nothing to review. (Supports pull_request + issue_comment /review)");
      return;
    }
    const { owner, repo } = ctx.repo;
    const configPath = core.getInput("config-path") || ".github/openreview.yml";
    const dryRun = (core.getInput("dry-run") || "false").toLowerCase() === "true";

    const { config, path } = await loadConfig(configPath);
    core.info(`Loaded config: ${path} (${config.reviews.length} reviews)`);
    const keys = resolveKeysFromEnv(process.env as any);
    const { fileNames, diff, headSha } = await getPrDiff(octokit, owner, repo, prNumber);
    const inScope = filterIgnored(fileNames, config.defaults.ignore ?? []);
    if (!diff.trim() || inScope.length === 0) {
      core.info("Empty diff or all files ignored.");
      return;
    }

    const perReview: { id: string; verdict: Verdict; findings: Finding[] }[] = [];
    for (const review of config.reviews) {
      const scopedFiles = inScope.filter((f) => matchesAny(f, review.if_paths));
      if (scopedFiles.length === 0) {
        core.info(`Review ${review.id}: no matching paths, skipped.`);
        continue;
      }
      // Build a scoped diff (best-effort: filter diff hunks by filename header)
      const scopedDiff = scopedFiles.length === inScope.length ? diff : diff; // keep full diff; agents see file names
      const tasks: Promise<Finding[]>[] = [];
      const agentDefs = [
        { ...review.main, name: review.main.name ?? `${review.id}:main` },
        ...review.subagents.map((s, i) => ({ ...s, name: s.name ?? `${review.id}:sub${i}` })),
      ];
      for (const a of agentDefs) {
        const provider = config.providers[a.provider];
        if (!provider) {
          core.warning(`Review ${review.id}: unknown provider '${a.provider}', skipped agent ${a.name}.`);
          continue;
        }
        tasks.push(
          runAgent({
            agentName: a.name ?? "agent",
            providerName: a.provider,
            provider,
            instructions: a.instructions,
            diff: scopedDiff,
            lang: config.defaults.lang ?? "en",
            keys,
            maxDiffChars: config.defaults.max_diff_chars ?? 80000,
          }).catch((e) => {
            core.warning(`Agent ${a.name} failed: ${(e as Error).message}`);
            return [] as Finding[];
          })
        );
      }
      let findings = (await Promise.all(tasks)).flat();
      if (review.verdict.deduplicate) findings = dedupeFindings(findings);
      findings.sort((a, b) =>
        ({ high: 0, medium: 1, suggestion: 2 } as const)[a.severity] -
        ({ high: 0, medium: 1, suggestion: 2 } as const)[b.severity]
      );
      const verdict = decideReviewVerdict(review.verdict.mode, review.verdict.min_severity, findings);
      perReview.push({ id: review.id, verdict, findings });
      core.info(`Review ${review.id}: ${findings.length} findings -> ${verdict}`);
    }

    const global = combineVerdicts(
      perReview.map((r) => r.verdict),
      config.global_verdict.strategy
    );
    const all = perReview.flatMap((r) => r.findings);
    core.setOutput("verdict", global);

    const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
    const sticky = renderStickyBody({
      verdict: global,
      perReview: perReview.map((r) => ({ id: r.id, verdict: r.verdict, count: r.findings.length })),
      findings: all,
      runUrl,
    });

    if (dryRun) {
      core.info(`DRY RUN verdict=${global}\n${sticky.slice(0, 2000)}`);
      return;
    }
    if (config.global_verdict.sticky_comment)
      await upsertStickyComment(octokit, owner, repo, prNumber, sticky);
    const wantInline = perReview.some((r) => r.findings.length > 0);
    if (wantInline) {
      try {
        await createInlineReview(octokit, owner, repo, prNumber, headSha, global, all);
      } catch (e) {
        core.warning(`Inline review failed (non-fatal): ${(e as Error).message}`);
      }
    }
    if (global === "request_changes" && config.global_verdict.fail_check_on_request_changes)
      core.setFailed("OpenReview verdict: request_changes");
  } catch (e) {
    core.setFailed((e as Error).message);
  }
}
