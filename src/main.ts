import * as core from "@actions/core";
import * as github from "@actions/github";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as YAML from "yaml";
import { parseConfig } from "./config.js";
import { templateContextFor, resolveExtends, mergeConfigs, parseConfigLoose } from "./templates.js";
import {
  resolveKeysFromEnv,
  runAgent,
  formatTokens,
  countsAsReview,
  type Finding,
  type AgentOutcome,
} from "./providers.js";
import {
  matchesAny, filterIgnored, dedupeFindings, decideReviewVerdict, combineVerdicts, combineBallots,
  applyDegradedFloor, resolveNoise, applyNoiseControls, splitDiff, scopeDiff, type Verdict,
  satisfiesActionVersion, runningActionVersion,
} from "./reviewer.js";
import { renderStickyBody, upsertStickyComment, createInlineReview, type RunStatus } from "./github.js";
import { initLogger, logInfo, logWarning, logDebug } from "./logger.js";
import { buildContextBlock } from "./context.js";
import { authorizeTrigger } from "./authorize.js";

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
    const loose = parseConfigLoose(raw);
    const extendsEntries = (loose.extends as string[] | undefined) ?? [];
    if (extendsEntries.length === 0) {
      return { config: parseConfig(raw), path: p };
    }
    // Templates resolve in order; this file overlays on top (child wins).
    const ctx = templateContextFor(p, process.env as any);
    const { merged, sources } = await resolveExtends(extendsEntries, ctx);
    const { extends: _ignored, ...top } = loose;
    const config = parseConfig(mergeConfigs(merged, top) as unknown);
    logInfo(
      `Resolved ${sources.length} template(s): ${sources
        .map((s) => (s.sha ? `${s.source} @${s.sha.slice(0, 7)}` : s.source))
        .join(", ")}`
    );
    return { config, path: p };
  }
  throw new Error(
    `No config found. Tried: ${candidates.join(", ")}. Add .github/openreview.yml (see openreview.example.yml).`
  );
}

/** Cap for paginated file listing (issue #50). GitHub renders at most one page
 * of 100 files per listFiles call; a 150-file PR used to silently review only
 * the first 100. We paginate everything and review up to this many, reporting
 * the rest — an invisible skip is worse than a visible one. */
export const MAX_DIFF_FILES = 300;

export type PrDiff = {
  fileNames: string[];
  diff: string;
  headSha: string;
  /** Files with no renderable patch (binary or too large to render). */
  omitted: string[];
  /** True when the PR touched more than MAX_DIFF_FILES files. */
  truncated: boolean;
  /** Total files touched by the PR, before the MAX_DIFF_FILES cap. */
  totalFiles: number;
};

export async function getPrDiff(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pr: number,
  payloadHeadSha?: string
): Promise<PrDiff> {
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    owner, repo, pull_number: pr, per_page: 100,
  });
  const truncated = files.length > MAX_DIFF_FILES;
  const capped = files.slice(0, MAX_DIFF_FILES);
  const parts: string[] = [];
  const names: string[] = [];
  const omitted: string[] = [];
  for (const f of capped) {
    names.push(f.filename);
    if (f.patch) parts.push(`--- a/${f.filename}\n+++ b/${f.filename}\n${f.patch}`);
    else omitted.push(f.filename);
  }
  if (truncated)
    logWarning(
      `Diff truncated: PR touches ${files.length} files, reviewing the first ${MAX_DIFF_FILES}.`
    );
  if (omitted.length > 0)
    logWarning(
      `${omitted.length} file(s) have no renderable patch (binary or too large) and were not sent to reviewers: ${omitted.slice(0, 10).join(", ")}${omitted.length > 10 ? ", …" : ""}`
    );
  // The pull_request payload already carries head.sha; only fall back to an
  // extra pulls.get when it is missing (issue_comment path).
  const headSha =
    payloadHeadSha ??
    (await octokit.rest.pulls.get({ owner, repo, pull_number: pr })).data.head.sha;
  return { fileNames: names, diff: parts.join("\n\n"), headSha, omitted, truncated, totalFiles: files.length };
}

/** Run thunks with at most `limit` in flight, preserving result order.
 * Takes thunks, NOT promises: an already-started promise is in flight before
 * the pool can see it, so passing promises caps nothing. */
export async function runPooled<T>(thunks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  if (thunks.length === 0) return [];
  const cap = Math.max(1, Math.min(limit, thunks.length));
  const out: T[] = new Array(thunks.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= thunks.length) return;
      out[i] = await thunks[i]();
    }
  };
  await Promise.all(Array.from({ length: cap }, worker));
  return out;
}

export async function run(): Promise<void> {
  try {
    initLogger();
    const token = process.env["INPUT_GITHUB-TOKEN"] || process.env.GITHUB_TOKEN || "";
    if (!token) throw new Error("Missing github-token (GITHUB_TOKEN).");
    const octokit = github.getOctokit(token);
    const ctx = github.context;
    const issue = (ctx.payload as any).issue;
    const prNumber =
      ctx.payload.pull_request?.number ??
      (issue?.pull_request ? issue.number : undefined) ??
      Number(process.env.PR_NUMBER ?? 0);
    if (!prNumber) {
      logWarning("No pull_request context; nothing to review. (Supports pull_request + issue_comment /review)");
      return;
    }
    const { owner, repo } = ctx.repo;
    const configPath = core.getInput("config-path") || ".github/openreview.yml";
    const dryRun = (core.getInput("dry-run") || "false").toLowerCase() === "true";

    const { config, path } = await loadConfig(configPath);
    logInfo(`Loaded config: ${path} (${config.reviews.length} reviews)`);
    if (config.requires_action) {
      const running = runningActionVersion(process.env as any);
      if (running && !satisfiesActionVersion(config.requires_action, running)) {
        throw new Error(
          `This openreview.yml needs action ${config.requires_action} but the runner is ${running}. ` +
            `Bump the workflow ref (e.g. uses: sankara-sabapathy/openreview@v1) to a release satisfying the constraint.`
        );
      }
    }
    const keys = resolveKeysFromEnv(process.env as any);
    // Authorization gate (issue #59): `issue_comment` runs in the BASE repo
    // context, so the secrets are live. Without this, anyone on the internet
    // could comment the command on any PR and spend the maintainer's keys.
    // Runs before the diff fetch, the key resolution and every agent call.
    const gate = authorizeTrigger({
      eventName: process.env.GITHUB_EVENT_NAME ?? "",
      commentBody: (ctx.payload as any).comment?.body,
      authorAssociation: (ctx.payload as any).comment?.author_association,
      command: config.defaults.command,
      allowedAssociations: core.getInput("allowed-author-associations"),
    });
    if (!gate.allowed) {
      // Exit 0: an unauthorized trigger must not paint a red X on a PR.
      logWarning(`Trigger denied: ${gate.reason}. Nothing was reviewed or posted.`);
      return;
    }
    // Run-wide wall-clock budget (issue #51). Every agent call clamps its own
    // timeout to what is left, and `runAgent` refuses to start once it is gone.
    const maxRuntimeS = config.defaults.max_runtime_s ?? 1200;
    const maxConcurrency = config.defaults.max_concurrency ?? 4;
    const deadlineAt = Date.now() + maxRuntimeS * 1000;
    logInfo(
      `Run budget: ${maxRuntimeS}s total, ${maxConcurrency} agent(s) in flight per review` +
        (config.reviews.length > 1
          ? `; projected worst case ~${Math.ceil(
              (config.reviews.length *
                config.reviews.reduce((n, r) => n + 1 + r.subagents.length, 0) *
                ((config.reviews[0].main ? 3 : 0) + 1)) /
                60
            )} min without the budget kicking in`
          : "")
    );
    // Stable session per workflow run (required by OpenCode Go/Zen routing).
    const sessionId =
      process.env.GITHUB_RUN_ID ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    logInfo(`Reviewing PR #${prNumber} in ${owner}/${repo}`);
    const { fileNames, diff, headSha, omitted, truncated, totalFiles } = await getPrDiff(
      octokit, owner, repo, prNumber, (ctx.payload as any).pull_request?.head?.sha
    );
    logInfo(`Diff: ${fileNames.length} files, ${diff.length} chars (head ${headSha.slice(0, 7)})`);
    logDebug(`Diff files: ${fileNames.join(", ")}`);
    if (truncated)
      logWarning(`PR touches more than ${MAX_DIFF_FILES} files; only the first ${MAX_DIFF_FILES} were reviewed.`);
    if (omitted.length > 0)
      logWarning(`${omitted.length} changed file(s) skipped (binary or patch too large): ${omitted.slice(0, 10).join(", ")}${omitted.length > 10 ? ", …" : ""}`);
    const inScope = filterIgnored(fileNames, config.defaults.ignore ?? []);
    if (!diff.trim() || inScope.length === 0) {
      logInfo("Empty diff or all files ignored.");
      return;
    }
    // Parse the multi-file diff once; every review scopes from this (#47).
    const parsedDiff = splitDiff(diff);
    if (parsedDiff.length === 0)
      logWarning(`Diff parser found no per-file patches for ${fileNames.length} changed file(s).`);

    type AgentRun = {
      agent: string;
      providerName: string;
      outcome: AgentOutcome;
      seconds: number;
      error?: string;
    };
    const perReview: {
      id: string;
      verdict: Verdict;
      findings: Finding[];
      errors: string[];
      /** Agents that actually reviewed (issue #46: only these may vote). */
      counted: boolean;
      agents: AgentRun[];
      usage: { agent: string; model: string; usage: { in: number; out: number }; seconds: number }[];
    }[] = [];
    for (const review of config.reviews) {
      const scopedFiles = inScope.filter((f) => matchesAny(f, review.if_paths));
      if (scopedFiles.length === 0) {
        logInfo(`Review ${review.id}: no matching paths, skipped.`);
        continue;
      }
      // Scoped diff (issue #47). `if_paths` used to decide only *whether* a
      // review ran — agents always got the whole PR diff, so a src/-only review
      // still paid for (and could comment on) website/ and dist/. Parsed once per
      // run, reused by every review and agent.
      const scopedDiff = scopeDiff(scopedFiles, parsedDiff, inScope.length);
      logDebug(
        `Review ${review.id}: ${scopedFiles.length}/${inScope.length} in-scope file(s) sent ` +
          `(${scopedDiff.length} chars)`
      );
      // Cross-file context (issue #20): full files + call-site excerpts, budgeted.
      const { block: contextBlock } = buildContextBlock({
        repoRoot: process.cwd(),
        scopedFiles,
        contextFiles: review.context_files,
        includeFullFiles:
          review.include_full_files ?? config.defaults.include_full_files ?? true,
        maxContextChars:
          review.max_context_chars ?? config.defaults.max_context_chars ?? 20000,
        ignore: config.defaults.ignore ?? [],
      });
      // Thunks, not promises: runAgent must not start until the pool allows it
      // (an eager promise is already in flight, so the cap would be a no-op).
      const tasks: (() => Promise<{
        findings: Finding[];
        usage: { in: number; out: number } | null;
        seconds: number;
        error?: string;
        outcome: AgentOutcome;
        agent: string;
        providerName: string;
      }>)[] = [];
      const agentDefs = [
        { ...review.main, name: review.main.name ?? `${review.id}:main` },
        ...review.subagents.map((s, i) => ({ ...s, name: s.name ?? `${review.id}:sub${i}` })),
      ];
      logInfo(
        `Review ${review.id}: launching ${agentDefs.length} agent(s) [${agentDefs
          .map((a) => `${a.name}/${a.provider}`)
          .join(", ")}] on ${scopedFiles.length} file(s), strategy=${review.strategy}`
      );
      for (const a of agentDefs) {
        const provider = config.providers[a.provider];
        if (!provider) {
          logWarning(`Review ${review.id}: unknown provider '${a.provider}', skipped agent ${a.name}.`);
          continue;
        }
        tasks.push(() =>
          runAgent({
            agentName: a.name ?? "agent",
            providerName: a.provider,
            provider,
            instructions: a.instructions,
            diff: scopedDiff,
            lang: config.defaults.lang ?? "en",
            keys,
            maxDiffChars: config.defaults.max_diff_chars ?? 80000,
            sessionId,
            contextBlock,
            deadlineAt,
          })
            .then((result) => ({
              findings: result.findings,
              usage: result.usage,
              seconds: result.seconds,
              outcome: result.outcome,
              agent: a.name ?? "agent",
              providerName: a.provider,
            }))
            .catch((e) => {
              const msg = (e as Error).message;
              logWarning(`Agent ${a.name} failed: ${msg}`);
              return {
                findings: [] as Finding[],
                usage: null,
                seconds: 0,
                error: msg,
                outcome: "error" as const,
                agent: a.name ?? "agent",
                providerName: a.provider,
              };
            })
        );
      }
      // Bounded fan-out (issue #51): run at most `max_concurrency` agents at a
      // time instead of bursting every agent at the provider at once. The
      // thunk is what makes the cap real — see runPooled.
      const results = await runPooled(tasks, maxConcurrency);
      let findings = results.flatMap((r) => r.findings);
      const agentErrors = results.filter((r) => r.error).map((r) => `- \`${r.agent}\`: ${r.error}`);
      if (review.verdict.deduplicate) findings = dedupeFindings(findings);
      // Noise controls (issue #21): confidence floor + cap, then verdict on survivors.
      const noise = resolveNoise({
        profile: review.profile ?? config.defaults.profile,
        min_confidence: review.min_confidence ?? config.defaults.min_confidence,
        max_findings: review.max_findings ?? config.defaults.max_findings,
      });
      const preNoise = findings.length;
      findings = applyNoiseControls(findings, noise).visible;
      if (findings.length < preNoise) {
        logInfo(
          `Review ${review.id}: noise controls dropped ${preNoise - findings.length} finding(s) ` +
            `(profile=${review.profile ?? config.defaults.profile}, min_confidence=${noise.min_confidence}, max_findings=${noise.max_findings})`
        );
      }
      findings.sort((a, b) =>
        ({ high: 0, medium: 1, suggestion: 2 } as const)[a.severity] -
        ({ high: 0, medium: 1, suggestion: 2 } as const)[b.severity]
      );
      // Fail closed (issue #46): a review whose every agent was skipped or
      // errored contributed NO usable signal, so it must not cast an approving
      // ballot — "no findings because nothing ran" is not "no findings found".
      const counted = results.filter((r) => countsAsReview(r.outcome)).length;
      // A partially-failed review DID get a look, but not the whole picture, so
      // it may not report a clean pass either: floor it at `comment` rather
      // than dropping its findings or claiming everything was checked.
      const degraded = counted > 0 && counted < results.length;
      const verdict = (() => {
        if (counted === 0) return "approve" as Verdict; // placeholder, excluded below
        // One ballot per distinct provider (issue #12). `any` reproduces the
        // old pooled behavior exactly; `all`/`majority` resolve disagreement.
        const byProvider = new Map<string, typeof findings>();
        for (const f of findings) {
          const list = byProvider.get(f.provider) ?? [];
          list.push(f);
          byProvider.set(f.provider, list);
        }
        const ballots = [...byProvider.entries()].map(([name, fs]) => {
          const v = decideReviewVerdict(review.verdict.mode, review.verdict.min_severity, fs);
          logInfo(`Review ${review.id}: ballot ${name} -> ${v} (${fs.length} findings)`);
          return v;
        });
        const base = combineBallots(ballots, review.strategy);
        if (degraded) {
          logWarning(
            `Review ${review.id}: only ${counted}/${results.length} agents reviewed — ` +
              `flooring the verdict instead of reporting a clean approve.`
          );
        }
        return applyDegradedFloor(base, counted, results.length);
      })();
      perReview.push({
        id: review.id,
        verdict,
        findings,
        errors: agentErrors,
        counted: counted > 0,
        agents: results.map((r) => ({
          agent: r.agent,
          providerName: r.providerName,
          outcome: r.outcome,
          seconds: r.seconds,
        })),
        usage: results
          .filter((r) => r.usage)
          .map((r) => ({
            agent: r.agent,
            model: config.providers[r.providerName]?.model ?? r.providerName,
            usage: r.usage as { in: number; out: number },
            seconds: r.seconds,
          })),
      });
      if (counted === 0) {
        logWarning(
          `Review ${review.id}: ${results.length} agent(s), none reviewed (no usable result) — ` +
            `excluded from the verdict.`
        );
      }
      logInfo(`Review ${review.id}: ${findings.length} findings -> ${verdict}${counted > 0 ? "" : " (excluded)"}`);
    }

    if (perReview.length === 0) {
      // Still publish both outputs: a consumer branching on
      // steps.review.outputs.verdict must not see an empty string here (the
      // dogfood review on #62 caught this regression).
      core.setOutput("verdict", "comment");
      core.setOutput("review_status", "error");
      logWarning(
        "No review matched any path in the diff (check if_paths / defaults.ignore) — " +
          "nothing was reviewed. review_status=error."
      );
      return;
    }

    // Only reviews that actually ran vote; a run where nothing did is reported
    // as `error` and can never come out as approve (issue #46).
    const countedReviews = perReview.filter((r) => r.counted);
    const global = combineVerdicts(
      countedReviews.map((r) => r.verdict),
      config.global_verdict.strategy
    );
    const status: RunStatus =
      countedReviews.length === 0
        ? "error"
        : countedReviews.length < perReview.length
        ? "partial"
        : "ok";
    const all = perReview.flatMap((r) => r.findings);
    core.setOutput("verdict", global);
    core.setOutput("review_status", status);

    const runUrl = `${process.env.GITHUB_SERVER_URL ?? "https://github.com"}/${owner}/${repo}/actions/runs/${process.env.GITHUB_RUN_ID ?? ""}`;
    const stickyBase = renderStickyBody({
      verdict: global,
      status,
      perReview: perReview.map((r) => ({
        id: r.id,
        verdict: r.verdict,
        count: r.findings.length,
        counted: r.counted,
      })),
      agents: perReview.flatMap((r) =>
        r.agents.map((a) => ({
          ...a,
          provider: a.providerName,
          review: r.id,
        }))
      ),
      findings: all,
      runUrl,
    });
    // Derived from actual agent outcomes, not from a hardcoded list of three
    // env var names — a config using key_from: env.GROQ_API_KEY used to be told
    // "No provider API keys configured" on a fully successful run (issue #49).
    const skippedNoKey = perReview.flatMap((r) => r.agents).filter((a) => a.outcome === "skipped-no-key");
    const allErrors = perReview.flatMap((r) => r.errors);
    // Consolidated usage, grouped by model: "model 12.3k/1.1k 38t/s".
    const usageByModel = new Map<string, { In: number; Out: number; seconds: number }>();
    for (const r of perReview) {
      for (const u of r.usage) {
        const e = usageByModel.get(u.model) ?? { In: 0, Out: 0, seconds: 0 };
        e.In += u.usage.in;
        e.Out += u.usage.out;
        e.seconds += u.seconds;
        usageByModel.set(u.model, e);
      }
    }
    const usageLine = [...usageByModel.entries()]
      .map(
        ([m, e]) =>
          `${m} ${formatTokens(e.In)}/${formatTokens(e.Out)}` +
          (e.Out > 0 && e.seconds > 0 ? ` ${(e.Out / e.seconds).toFixed(0)}t/s` : "")
      )
      .join(" · ");
    let sticky = stickyBase;
    if (truncated || omitted.length > 0) {
      const bits: string[] = [];
      if (truncated) bits.push(`only the first ${MAX_DIFF_FILES} of ${totalFiles} changed files were reviewed`);
      if (omitted.length > 0)
        bits.push(
          `${omitted.length} file(s) not reviewable (binary or diff too large): ${omitted.slice(0, 8).map((f) => `\`${f}\``).join(", ")}${omitted.length > 8 ? ", …" : ""}`
        );
      sticky += `\n\n> ⚠️ ${bits.join(". ")}.`;
    }
    if (usageLine) {
      sticky += `\n<sub>Models: ${usageLine}</sub>`;
      logInfo(`Usage: ${usageLine}`);
    }
    if (skippedNoKey.length > 0) {
      const names = [...new Set(skippedNoKey.map((a) => a.agent))].map((a) => `\`${a}\``).join(", ");
      sticky +=
        `\n\n> ⚠️ ${skippedNoKey.length} agent(s) skipped — no API key for their provider: ${names}. ` +
        `Add the secret each provider's \`key_from\` names (see \`.github/openreview.yml\`).`;
      logWarning(`${skippedNoKey.length} agent(s) skipped for a missing API key: ${names}`);
    }
    if (allErrors.length > 0) {
      const scope =
        status === "error"
          ? "⚠️ All agents failed — no review completed"
          : `⚠️ ${allErrors.length} agent error(s)`;
      sticky += `\n\n<details><summary>${scope} — details</summary>\n\n${allErrors.join("\n")}\n\nCheck model IDs and base URLs against the provider docs. Secrets are never logged.</details>`;
    }
    if (dryRun) {
      logInfo(`DRY RUN verdict=${global} status=${status}\n${sticky.slice(0, 2000)}`);
      return;
    }
    if (config.global_verdict.sticky_comment) {
      await upsertStickyComment(octokit, owner, repo, prNumber, sticky);
      logInfo(`Published sticky comment (verdict ${global}, ${all.length} findings).`);
    }
    const wantInline = perReview.some((r) => r.findings.length > 0);
    if (wantInline) {
      try {
        await createInlineReview(octokit, owner, repo, prNumber, headSha, global, all);
        logInfo(`Published inline review (${global}).`);
      } catch (e) {
        logWarning(`Inline review failed (non-fatal): ${(e as Error).message}`);
      }
    }
    if (global === "request_changes" && config.global_verdict.fail_check_on_request_changes)
      core.setFailed("OpenReview verdict: request_changes");
  } catch (e) {
    core.setFailed((e as Error).message);
  }
}
