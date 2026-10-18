/**
 * In-thread Q&A (issue #23): `/ask <question>` on a PR answers from the
 * diff, and reactions on bot comments are logged as structured feedback
 * signal (the learning half of issue #43; no behavior change yet).
 */

export const ASK_COMMAND = "/ask";

/** A parsed `/ask` comment: the question plus any `>`-quoted context. */
export type AskRequest = {
  /** The question with quote lines removed. */
  question: string;
  /** `>`-quoted lines, unquoted and joined (may be empty). */
  quoted: string;
};

/**
 * Parse an issue-comment body as an `/ask` invocation. Returns null unless
 * the trimmed body starts with `/ask` (case-insensitive); a bare `/ask`
 * with no question is also null so the caller can post usage instead.
 */
export function parseAskComment(body: string | undefined): AskRequest | null {
  if (!body) return null;
  const lines = body.trim().split("\n");
  const first = (lines[0] ?? "").trim();
  if (first.toLowerCase() !== ASK_COMMAND && !first.toLowerCase().startsWith(ASK_COMMAND + " ")) return null;
  const rest = [first.slice(ASK_COMMAND.length), ...lines.slice(1)].join("\n");
  const quoted: string[] = [];
  const question: string[] = [];
  for (const line of rest.split("\n")) {
    const t = line.trim();
    if (t.startsWith(">")) quoted.push(t.replace(/^>\s?/, ""));
    else if (t) question.push(t);
  }
  const q = question.join("\n").trim();
  if (!q) return null;
  return { question: q, quoted: quoted.join("\n").trim() };
}

/**
 * Render the Q&A prompt. Grounded in the (possibly truncated) PR diff plus
 * the previous round's recorded findings; the quoted reply context comes
 * last so a quoted finding stays adjacent to the question about it.
 */
export function buildAskPrompt(opts: {
  diff: string;
  priorFindings: { file: string; line?: number; comment: string }[];
  quoted: string;
  question: string;
}): { system: string; user: string } {
  const system =
    "You answer questions about a pull request under review. " +
    "Ground every claim in the diff below; say plainly when the diff does not contain the answer. " +
    "Reply in markdown, concise: short paragraphs and bullets. No JSON, no code fences unless showing code.";
  const prior =
    opts.priorFindings.length > 0
      ? opts.priorFindings
          .slice(0, 20)
          .map((f, i) => `${i + 1}. ${f.file}${f.line !== undefined ? `:${f.line}` : ""} — ${f.comment.replace(/\s+/g, " ").slice(0, 200)}`)
          .join("\n")
      : "(no prior findings recorded)";
  const quoted = opts.quoted ? `\n\nQuoted context from the thread:\n${opts.quoted.slice(0, 2000)}` : "";
  return {
    system,
    user:
      `PR diff (truncated):\n\n${opts.diff}\n\n` +
      `Previous round's recorded findings:\n${prior}` +
      quoted +
      `\n\nQuestion: ${opts.question}`,
  };
}

/** One bot comment's reaction signal. */
export type CommentReactions = {
  commentId: number;
  url: string;
  counts: Record<string, number>;
};

/**
 * Aggregate reactions on the bot's own PR comments (sticky + replies).
 * Inline review-thread reactions need per-review-comment IDs, which runs
 * do not retain — documented residual, not silent loss: the sticky is the
 * durable feedback surface. Never throws: signal collection must not fail
 * a review or an answer.
 */
export async function collectFeedbackSignals(
  octokit: {
    paginate: (...args: any[]) => Promise<any[]>;
    rest: {
      issues: { listComments: unknown };
      reactions: { listForIssueComment: (p: any) => Promise<{ data: any[] }> };
    };
  },
  owner: string,
  repo: string,
  prNumber: number,
  botMarker = "<!-- openreview:"
): Promise<{ comments: CommentReactions[]; totals: Record<string, number> }> {
  const comments: CommentReactions[] = [];
  const totals: Record<string, number> = {};
  try {
    const all = await octokit.paginate(octokit.rest.issues.listComments as any, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100,
    });
    const botComments = all.filter(
      (c: any) => c?.user?.type === "Bot" && typeof c?.body === "string" && c.body.includes(botMarker)
    );
    for (const c of botComments.slice(0, 20)) {
      const { data } = await octokit.rest.reactions.listForIssueComment({
        owner,
        repo,
        comment_id: c.id,
      });
      const counts: Record<string, number> = {};
      for (const r of data ?? []) {
        const key = String((r as any).content ?? "unknown");
        counts[key] = (counts[key] ?? 0) + 1;
        totals[key] = (totals[key] ?? 0) + 1;
      }
      comments.push({ commentId: c.id, url: c.html_url ?? "", counts });
    }
  } catch {
    // Signal is best-effort; an API failure is not a review failure.
  }
  return { comments, totals };
}
