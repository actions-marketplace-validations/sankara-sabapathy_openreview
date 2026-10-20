import type { Finding } from "./providers.js";

/**
 * The main agent as a synthesizer. In `main_mode: synthesize` (the default)
 * subagents review first; `main` then sees the diff PLUS their findings, and
 * returns the merged list, a PR summary and a per-file walkthrough. Before
 * this, `main` ran in parallel with the subagents and never saw what they
 * reported, so the "synthesize" instruction every config gave it was a no-op.
 *
 * Fail-safe by construction: the synthesizer can merge or dismiss a prior
 * finding only by naming its id. A finding it never mentions (forgotten,
 * truncated out of the prompt, invented id) is kept unchanged, and a
 * synthesizer that fails outright falls back to the plain union.
 */

/** A subagent finding with the id the synthesizer refers to it by. */
export type LabeledFinding = { id: string; finding: Finding };

export type WalkthroughEntry = { file: string; change: string };

/** What the synthesizer returned beyond its findings. */
export type Synthesis = {
  summary: string;
  walkthrough: WalkthroughEntry[];
  dismissed: { id: string; reason: string }[];
  /** Prior-finding ids each output finding merges, aligned with its findings. */
  sources: string[][];
};

export function labelFindings(findings: Finding[]): LabeledFinding[] {
  return findings.map((finding, i) => ({ id: `F${i + 1}`, finding }));
}

export const SYNTH_SCHEMA =
  '{"summary":string,"walkthrough":[{"file":string,"change":string}],' +
  '"findings":[{"file":string,"line":number|null,"severity":"high|medium|suggestion","category":string,"comment":string,"confidence":0-1,"sources":["F1"]}],' +
  '"dismissed":[{"id":"F2","reason":string}]}';

export const SYNTH_SYSTEM = (lang: string, instructions: string) =>
  `You are the lead code reviewer synthesizing a multi-agent review. Language: ${lang}.
Custom instructions: ${instructions}

You get the diff and the findings other reviewers reported, each with an id (F1, F2, ...). Your job:
1. Verify every prior finding against the diff. Keep the real ones. Merge duplicates into ONE finding whose "sources" lists every merged id. Put false positives in "dismissed" with a one-line reason. Dismiss only what the diff clearly disproves; when unsure, keep it.
2. Add real issues the others missed, with "sources": [].
3. "summary": 2-4 sentences on what this PR does and where its risk is.
4. "walkthrough": one entry per changed file (group trivial files), one sentence each on what changed.

OUTPUT FORMAT — mandatory, and your reply is checked against it:
Reply with ONE JSON object and NOTHING else. The first character must be "{" and the last must be "}".
No markdown, no headings, no bullets, no code fences, no preamble.
Schema: ${SYNTH_SCHEMA}

Be strict on bugs/security, lenient on style.`;

export const SYNTH_REMINDER = `\n\nReminder: your entire reply must be one JSON object of this exact shape, nothing else:\n${SYNTH_SCHEMA}`;

/**
 * Prior findings as one JSON object per line, bounded by `maxChars`. Findings
 * past the budget are left out of the prompt — and, because the synthesizer
 * cannot name them, kept unchanged by mergeSynthesis.
 */
export function renderPriorFindings(labeled: LabeledFinding[], maxChars = 30000): string {
  if (labeled.length === 0) return "<prior_findings>\nNone. The other reviewers reported nothing (or none ran).\n</prior_findings>";
  const lines: string[] = [];
  let used = 0;
  for (const { id, finding: f } of labeled) {
    const line = JSON.stringify({
      id,
      file: f.file,
      line: f.line ?? null,
      severity: f.severity,
      category: f.category,
      comment: f.comment,
      confidence: f.confidence,
      agent: f.agent,
    });
    if (used + line.length > maxChars) break;
    lines.push(line);
    used += line.length + 1;
  }
  const omitted = labeled.length - lines.length;
  const note = omitted > 0 ? `\n(${omitted} more finding(s) omitted for length; they are kept as reported.)` : "";
  return `<prior_findings>\n${lines.join("\n")}${note}\n</prior_findings>`;
}

const clip = (s: unknown, n: number) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/**
 * Pull the synthesis fields out of the parsed reply object. `rawFindings` is
 * the reply's findings array; only entries the caller kept (`kept[i]` true)
 * contribute a sources row, so `sources` stays aligned with the Finding[] the
 * caller built.
 */
export function parseSynthesis(holder: any, rawFindings: any[], kept: boolean[]): Synthesis {
  const walk = Array.isArray(holder?.walkthrough) ? holder.walkthrough : [];
  const dis = Array.isArray(holder?.dismissed) ? holder.dismissed : [];
  return {
    summary: clip(holder?.summary, 1200),
    walkthrough: walk
      .filter((w: any) => w && w.file && w.change)
      .slice(0, 40)
      .map((w: any) => ({ file: clip(w.file, 200), change: clip(w.change, 300) })),
    dismissed: dis
      .filter((d: any) => d && typeof d.id === "string")
      .map((d: any) => ({ id: d.id.trim(), reason: clip(d.reason, 300) || "no reason given" })),
    sources: rawFindings
      .filter((_, i) => kept[i])
      .map((f: any) =>
        Array.isArray(f?.sources) ? f.sources.filter((s: unknown) => typeof s === "string").map((s: string) => s.trim()) : []
      ),
  };
}

/**
 * Merge the synthesizer's verdict on the prior findings into one list.
 * - A synthesized finding citing known ids inherits their attribution and
 *   votes under every source agent (so `strategy: all|majority` keeps
 *   meaning one ballot per agent). One citing none is the main agent's own.
 * - A prior id named in `dismissed` (and cited by no finding) is removed and
 *   reported with its reason, never dropped silently.
 * - A prior id the synthesizer never mentions is kept unchanged.
 */
export function mergeSynthesis(
  labeled: LabeledFinding[],
  synthFindings: Finding[],
  synth: Synthesis
): { findings: Finding[]; dismissed: { finding: Finding; reason: string }[] } {
  const byId = new Map(labeled.map((l) => [l.id, l.finding]));
  const cited = new Set<string>();
  const out: Finding[] = [];
  synthFindings.forEach((f, i) => {
    const srcs = [...new Set(synth.sources[i] ?? [])].filter((id) => byId.has(id));
    srcs.forEach((id) => cited.add(id));
    if (srcs.length === 0) {
      // The synthesizer's own addition: new to this run (issue #18).
      out.push(f.status ? f : { ...f, status: "new" as const });
      return;
    }
    const origins = srcs.map((id) => byId.get(id)!);
    const agents = [...new Set(origins.map((o) => o.agent))];
    // Validation inherits through the merge (issue #18): the synthesizer
    // never sees the prior round itself, so a merged finding keeps its
    // sources' verdict — fixed only when every source says fixed.
    const inherited =
      origins.every((o) => o.status === "fixed")
        ? ("fixed" as const)
        : origins.some((o) => (o.status ?? "new") === "new")
          ? ("new" as const)
          : ("open" as const);
    // Suggestions ride the same path (issue #22): an explicit synthesizer
    // suggestion wins, otherwise the first cited source's survives.
    const inheritedSuggestion = origins.map((o) => o.suggestion).find((s) => s !== undefined);
    out.push({
      ...f,
      status: f.status ?? inherited,
      ...(f.suggestion !== undefined
        ? {}
        : inheritedSuggestion !== undefined
          ? { suggestion: inheritedSuggestion }
          : {}),
      agent: agents.join("+"),
      provider: origins[0].provider,
      model: origins[0].model,
      voters: [...new Set(origins.flatMap((o) => (o.voters?.length ? o.voters : [o.provider])))],
    });
  });
  const reasons = new Map(synth.dismissed.map((d) => [d.id, d.reason]));
  const dismissed: { finding: Finding; reason: string }[] = [];
  for (const { id, finding } of labeled) {
    if (cited.has(id)) continue;
    const reason = reasons.get(id);
    if (reason !== undefined) dismissed.push({ finding, reason });
    else out.push(finding);
  }
  return { findings: out, dismissed };
}
