import * as github from "@actions/github";
import { lineInRanges } from "./reviewer.js";

export const STICKY_MARKER = "<!-- openreview:sticky -->";

function actionBase(): { repo: string; ref: string } {
  // Prefer the action's own coordinates so forks/renames keep working; the
  // hardcoded default matches this repo's published location.
  const repo = process.env.GITHUB_ACTION_REPOSITORY || "sankara-sabapathy/openreview";
  const ref = process.env.GITHUB_ACTION_REF || "";
  // With `uses: ./` (how PRs dogfood unreleased changes) GITHUB_ACTION_REF is the
  // checkout ref — `refs/pull/62/merge` — which raw.githubusercontent cannot
  // serve, so the logo would 404 in every comment. Prefer the PR's head branch,
  // then any plain branch/tag, and fall back to the default branch.
  //
  // Only trust GITHUB_HEAD_REF when the head branch actually lives in THIS
  // repo: on a fork PR it does not, and {base}/{head}/assets 404s — the exact
  // failure this function exists to prevent.
  const headRepo = (github.context?.payload as any)?.pull_request?.head?.repo?.full_name;
  const head =
    typeof headRepo === "string" && headRepo.toLowerCase() === repo.toLowerCase()
      ? process.env.GITHUB_HEAD_REF || ""
      : "";
  if (head && !head.includes("..") && !/[~^:\\]|\s/.test(head)) return { repo, ref: head };
  if (/^[\w.\-/]+$/.test(ref) && !ref.startsWith("refs/")) return { repo, ref };
  return { repo, ref: "main" };
}

export function logoUrl(): string {
  const { repo, ref } = actionBase();
  return `https://raw.githubusercontent.com/${repo}/${ref}/assets/logo.svg`;
}

export type RunStatus = "ok" | "partial" | "error";

const OUTCOME_LABEL: Record<string, string> = {
  ok: "✅ reviewed",
  "no-findings": "✅ no findings",
  "skipped-no-key": "⏭️ skipped (no key)",
  "budget-exhausted": "⏱️ skipped (run budget)",
  unparseable: "⚠️ unusable response",
  error: "❌ failed",
};

function logoImg(): string {
  return `<img src="${logoUrl()}" width="28" height="28" align="left" alt="OpenReview AI" />`;
}

/** Fresh sticky body for append mode's first run and post-rotation runs. */
function freshAppendBody(section: string): string {
  return [STICKY_MARKER, logoImg(), section, `\n${REREVIEW_LINE}`].join("\n");
}

type RunContentOpts = {
  verdict: string;
  status?: RunStatus;
  perReview: { id: string; verdict: string; count: number; counted?: boolean }[];
  agents?: {
    review: string;
    agent: string;
    provider: string;
    outcome: string;
    seconds: number;
  }[];
  findings?: {
    file: string;
    line?: number;
    severity: string;
    category: string;
    comment: string;
    agent: string;
    provider: string;
    model: string;
  }[];
  runUrl?: string;
};

/** Verdict heading text shared by update (`##`) and append (`###`) modes. */
function verdictTitle(verdict: string, status: RunStatus): string {
  return status === "error" ? "REVIEW FAILED" : verdict.replace(/_/g, " ").toUpperCase();
}

/**
 * The per-run content core: everything after the heading through the
 * agent-details block. Shared by the update body and append sections so both
 * render identically (issue #69).
 */
function renderRunBody(opts: RunContentOpts): string[] {
  const status = opts.status ?? "ok";
  const findings = opts.findings ?? [];
  const lines: string[] = [];
  lines.push("");
  lines.push("");
  lines.push("<br />");
  lines.push("");
  if (status === "partial") {
    const failed = opts.perReview.filter((r) => r.counted === false).map((r) => r.id);
    lines.push(
      `> ⚠️ **Partial review** — ${failed.map((i) => `\`${i}\``).join(", ")} produced no usable result and did not vote.`
    );
    lines.push("");
  }
  for (const r of opts.perReview)
    lines.push(
      `- \`${r.id}\`: **${r.counted === false ? "not reviewed" : r.verdict}** (${r.count} findings)`
    );
  lines.push("");
  if (status === "error") {
    lines.push("**No review completed.** The verdict below is not a pass — see the agent results.");
    lines.push("");
  }
  if (findings.length === 0) {
    lines.push(
      status === "ok"
        ? "No actionable findings. Nice work."
        : "No findings were produced (the run did not complete cleanly)."
    );
  } else {
    lines.push("| Severity | File | Finding | Agent |");
    lines.push("|---|---|---|---|");
    for (const f of findings.slice(0, 50)) {
      const loc = f.line ? `${f.file}:${f.line}` : f.file;
      const one = f.comment.replace(/\n+/g, " ").replace(/\|/g, "\\|").slice(0, 220);
      lines.push(`| ${f.severity} | \`${loc}\` | ${one} | ${f.agent}/${f.provider}/${f.model} |`);
    }
    if (findings.length > 50)
      lines.push(`\n… and ${findings.length - 50} more (see inline comments).`);
  }
  const agents = opts.agents ?? [];
  const rough = agents.filter((a) => a.outcome !== "ok" && a.outcome !== "no-findings");
  if (agents.length > 0) {
    lines.push("");
    lines.push(
      `<details><summary>🤖 ${agents.length} agent(s)${rough.length ? ` — ${rough.length} not clean` : ""}</summary>`
    );
    lines.push("");
    lines.push("| Agent | Provider | Outcome | Time |");
    lines.push("|---|---|---|---|");
    for (const a of agents) {
      lines.push(
        `| ${a.agent} | ${a.provider} | ${OUTCOME_LABEL[a.outcome] ?? a.outcome} | ${a.seconds.toFixed(1)}s |`
      );
    }
    lines.push("");
    lines.push("</details>");
  }
  return lines;
}

const REREVIEW_LINE = "<sub>Re-review with `/review`. Config: `.github/openreview.yml`.</sub>";

export function renderStickyBody(opts: {
  verdict: string;
  status?: RunStatus;
  perReview: { id: string; verdict: string; count: number; counted?: boolean }[];
  agents?: {
    review: string;
    agent: string;
    provider: string;
    outcome: string;
    seconds: number;
  }[];
  findings: {
    file: string;
    line?: number;
    severity: string;
    category: string;
    comment: string;
    agent: string;
    provider: string;
    model: string;
  }[];
  runUrl?: string;
}): string {
  const status = opts.status ?? "ok";
  const lines: string[] = [];
  lines.push(STICKY_MARKER);
  lines.push(logoImg());
  // Fail loud: a run where nothing was reviewed must never read as a pass
  // (issue #46). "APPROVE / No actionable findings. Nice work." was printed for
  // runs where every agent had errored.
  lines.push(`## OpenReview AI — ${verdictTitle(opts.verdict, status)}`);
  lines.push(...renderRunBody(opts));
  if (opts.runUrl) lines.push(`\n<sub>Run: ${opts.runUrl}</sub>`);
  lines.push(`\n${REREVIEW_LINE}`);
  return lines.join("\n");
}

/**
 * One run's section for append mode (issue #69): headed by short SHA +
 * verdict + run link, same content core as the update body, then the run's
 * footer extras (usage, warnings — assembled by the caller).
 */
export function renderAppendSection(
  opts: RunContentOpts & { headSha: string; runUrl?: string; extras?: string[] }
): string {
  const status = opts.status ?? "ok";
  const short = opts.headSha.slice(0, 7);
  const runLink = opts.runUrl ? ` ([run](${opts.runUrl}))` : "";
  const lines = [
    `### \`${short}\` — ${verdictTitle(opts.verdict, status)}${runLink}`,
    ...renderRunBody(opts),
  ];
  for (const e of opts.extras ?? []) lines.push(e);
  return lines.join("\n");
}

/** GitHub hard-caps comments at 65536 chars; rotate well before hitting it. */
export const STICKY_LIMIT = 60000;

/** GitHub's hard comment cap. */
export const GITHUB_COMMENT_LIMIT = 65536;

/**
 * Mark a rotated comment as superseded (issue #69). Drops the marker so
 * future lookups select the NEW comment — keeping it re-selected the old one
 * on every run, rotating forever (dogfood on #75). Caps at the GitHub limit
 * so the marking edit itself can never 422 (dogfood on #75).
 */
export function markSuperseded(body: string): string {
  const mark = `\n\n> _History rotated — continued in the newest sticky comment._`;
  const unmarked = body.replace(STICKY_MARKER + "\n", "");
  const full = unmarked + mark;
  return full.length > GITHUB_COMMENT_LIMIT ? full.slice(0, GITHUB_COMMENT_LIMIT - mark.length) + mark : full;
}

/**
 * Pure append: existing body + section, trailing re-review line kept last.
 * Reports rotation when the result would pass STICKY_LIMIT — the caller then
 * creates a fresh comment and marks the old one superseded.
 */
export function appendToSticky(
  existing: string,
  section: string
): { body: string; rotated: boolean } {
  const tail = `\n${REREVIEW_LINE}`;
  const base = existing.endsWith(tail) ? existing.slice(0, -tail.length) : existing;
  const body = `${base}\n\n---\n\n${section}${tail}`;
  return body.length > STICKY_LIMIT ? { body: "", rotated: true } : { body, rotated: false };
}

type Octokit = ReturnType<typeof github.getOctokit>;

/** The hardened sticky lookup, shared by update and append modes (issue #53). */
export async function findStickyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number
) {
  // Paginate everything: on a busy PR the sticky may sit past comment 100,
  // and stopping at the first page posted duplicate stickies (issue #53).
  const comments = await octokit.paginate(octokit.rest.issues.listComments, {
    owner, repo, issue_number: issueNumber, per_page: 100,
  });
  // The marker must be the FIRST line and the comment bot-authored. Matching
  // `includes` anywhere let any user hijack the sticky: their comment got
  // picked and the update 403d, failing the whole run (issue #53).
  // Residual: a *different* bot planting the exact first-line marker would
  // still match — but that is overt sabotage with a loud 403, not silent
  // corruption, and authorship cannot be proven further via REST (dogfood #73).
  return (
    comments.find(
      (c) => c.user?.type === "Bot" && typeof c.body === "string" && c.body.startsWith(STICKY_MARKER)
    ) ?? null
  );
}

export async function upsertStickyComment(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  body: string
): Promise<void> {
  const prev = await findStickyComment(octokit, owner, repo, issueNumber);
  if (prev) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: prev.id, body });
  } else {
    await octokit.rest.issues.createComment({ owner, repo, issue_number: issueNumber, body });
  }
}

/**
 * Append-mode publish (issue #69): the sticky becomes a per-run history.
 * First run creates a marker+logo+section body; later runs append sections.
 * Past STICKY_LIMIT a fresh comment starts and the old one is marked
 * superseded, so there is always one canonical comment.
 *
 * Two accepted residuals (dogfood on #75), both loud, neither silent:
 * - Concurrent runs race read-modify-write (the REST API offers no
 *   compare-and-swap, and update mode has always shared this): the loser’s
 *   section is missing from history, but its findings remain in that run’s
 *   inline review and logs. No retry can close it — only narrow it.
 * - A single section is assumed under STICKY_LIMIT: renderer caps (50
 *   findings rows, 10 file notes, 12 agents) bound it to ~16KB worst case,
 *   4x headroom. If caps ever grow past the limit, creation 422s loudly.
 */
export async function appendStickySection(
  octokit: Octokit,
  owner: string,
  repo: string,
  issueNumber: number,
  section: string
): Promise<{ rotated: boolean }> {
  const prev = await findStickyComment(octokit, owner, repo, issueNumber);
  if (!prev?.body) {
    await octokit.rest.issues.createComment({
      owner, repo, issue_number: issueNumber, body: freshAppendBody(section),
    });
    return { rotated: false };
  }
  const { body, rotated } = appendToSticky(prev.body, section);
  if (!rotated) {
    await octokit.rest.issues.updateComment({ owner, repo, comment_id: prev.id, body });
    return { rotated: false };
  }
  await octokit.rest.issues.createComment({
    owner, repo, issue_number: issueNumber, body: freshAppendBody(section),
  });
  await octokit.rest.issues.updateComment({
    owner, repo, comment_id: prev.id, body: markSuperseded(prev.body),
  });
  return { rotated: true };
}

/** Result of posting an inline review: posted vs dropped counts. */
export type InlineResult = { posted: number; dropped: number };

export async function createInlineReview(
  octokit: ReturnType<typeof github.getOctokit>,
  owner: string,
  repo: string,
  pullNumber: number,
  commitSha: string,
  verdict: "approve" | "comment" | "request_changes",
  findings: { file: string; line?: number; comment: string }[],
  /** Commentable line ranges per changed file (new-file coordinates). */
  validLines: Map<string, { start: number; end: number }[]>
): Promise<InlineResult> {
  const event = verdict === "approve" ? "APPROVE" : verdict === "request_changes" ? "REQUEST_CHANGES" : "COMMENT";
  // Validate BEFORE posting (issue #53): `file`/`line` are unvalidated model
  // output, and one bad position 422s the entire batch — 19 good findings
  // lost with it. Invalid entries never reach the API; the caller reports
  // the dropped count on the sticky instead of failing silently.
  let dropped = 0;
  const comments = [];
  const fileLevel: { file: string; comment: string }[] = [];
  // No early exit at the 20-comment cap: the loop must still collect later
  // file-level notes and count later drops, or the sticky understates what
  // never made it inline (dogfood on #73).
  for (const f of findings) {
    if (!f.line || f.line <= 0) {
      // File-level notes need a real path too (dogfood on #73): a
      // model-invented file would otherwise publish unchecked.
      if (!validLines.has(f.file)) {
        dropped++;
        continue;
      }
      fileLevel.push({ file: f.file, comment: f.comment });
      continue;
    }
    const ranges = validLines.get(f.file);
    if (!ranges || !lineInRanges(f.line, ranges)) {
      dropped++;
      continue;
    }
    if (comments.length < 20) comments.push({ path: f.file, line: f.line as number, body: f.comment });
    else dropped++; // valid but over the cap — counted, not silently lost
  }
  // File-level (line-less) findings used to be silently discarded by the
  // `.filter(line > 0)`; they now ride in the review body (issue #53).
  let body =
    `<img src="${logoUrl()}" width="20" height="20" alt="OpenReview AI" /> **OpenReview AI:** ${verdict} (${findings.length} findings)`;
  if (fileLevel.length > 0) {
    const shown = fileLevel.slice(0, 10);
    body += "\n\n**File-level notes:**\n" + shown.map((f) => `- \`${f.file}\`: ${f.comment}`).join("\n");
    if (fileLevel.length > shown.length)
      body += `\n… and ${fileLevel.length - shown.length} more (see sticky comment).`;
  }
  await octokit.rest.pulls.createReview({
    owner, repo, pull_number: pullNumber, commit_id: commitSha, event: event as any,
    body,
    comments: comments.slice(0, 20) as any,
  });
  return { posted: comments.length, dropped };
}
