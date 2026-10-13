/**
 * Scoring for the bug benchmark (benchmark/cases). Pure: no I/O, no network,
 * so the matching rules are unit-tested and a saved run can be re-scored
 * without spending provider budget.
 */

export type Severity = "high" | "medium" | "suggestion";

/** One seeded bug. `lines` are new-file line numbers, inclusive. */
export type ExpectedBug = {
  id: string;
  file: string;
  lines: [number, number];
  severity: Exclude<Severity, "suggestion">;
  summary: string;
  /** Used only for findings that carry no line number. */
  keywords: string[];
};

export type BenchCase = {
  id: string;
  language: string;
  description: string;
  /** Empty for clean cases: every finding on them is a false positive. */
  bugs: ExpectedBug[];
};

/** The subset of a reviewer Finding the scorer reads. */
export type ScoredFinding = {
  file: string;
  line?: number;
  severity: Severity;
  comment: string;
};

export type ScoreOptions = {
  /** Lines of slack around a bug's range (models often point one line off). */
  tolerance: number;
  /** Findings below this severity are dropped before scoring. */
  minSeverity: Severity;
};

export const DEFAULT_SCORE_OPTIONS: ScoreOptions = { tolerance: 3, minSeverity: "suggestion" };

const RANK: Record<Severity, number> = { high: 0, medium: 1, suggestion: 2 };

/**
 * Does `f` point at `bug`? Same file, and either a line inside the bug's range
 * (± tolerance) or, when the model gave no line, a keyword in the comment.
 * A finding with a line far from the bug never matches on keywords alone:
 * "SQL injection on line 40" is not credit for a bug on line 14.
 */
export function findingMatchesBug(f: ScoredFinding, bug: ExpectedBug, tolerance: number): boolean {
  if (normalizePath(f.file) !== normalizePath(bug.file)) return false;
  if (typeof f.line === "number" && f.line > 0) {
    return f.line >= bug.lines[0] - tolerance && f.line <= bug.lines[1] + tolerance;
  }
  const text = f.comment.toLowerCase();
  return bug.keywords.some((k) => text.includes(k.toLowerCase()));
}

function normalizePath(p: string): string {
  return p.replace(/^\.?\//, "").replace(/^[ab]\//, "");
}

export type CaseScore = {
  id: string;
  bugs: number;
  findings: number;
  /** Bugs found (each counted once). */
  tp: number;
  /** Findings that match no seeded bug. */
  fp: number;
  /** Bugs nobody found. */
  fn: number;
  /** Extra findings on a bug already credited: neither TP nor FP. */
  duplicates: number;
  found: string[];
  missed: string[];
  falsePositives: ScoredFinding[];
};

/**
 * Score one case. Findings are assigned to bugs by maximum bipartite matching,
 * so one vague finding that touches two adjacent bugs cannot starve the
 * precise finding for the second one.
 */
export function scoreCase(c: BenchCase, findings: ScoredFinding[], opts: ScoreOptions = DEFAULT_SCORE_OPTIONS): CaseScore {
  const kept = findings.filter((f) => RANK[f.severity] <= RANK[opts.minSeverity]);
  const candidates = kept.map((f) => c.bugs.map((b, j) => (findingMatchesBug(f, b, opts.tolerance) ? j : -1)).filter((j) => j >= 0));
  const owner: number[] = new Array(c.bugs.length).fill(-1);
  const tryAssign = (i: number, seen: boolean[]): boolean => {
    for (const j of candidates[i]) {
      if (seen[j]) continue;
      seen[j] = true;
      if (owner[j] === -1 || tryAssign(owner[j], seen)) {
        owner[j] = i;
        return true;
      }
    }
    return false;
  };
  for (let i = 0; i < kept.length; i++) tryAssign(i, new Array(c.bugs.length).fill(false));

  const assigned = new Set(owner.filter((i) => i >= 0));
  const falsePositives: ScoredFinding[] = [];
  let duplicates = 0;
  kept.forEach((f, i) => {
    if (assigned.has(i)) return;
    if (candidates[i].length > 0) duplicates++;
    else falsePositives.push(f);
  });
  const found = c.bugs.filter((_, j) => owner[j] >= 0).map((b) => b.id);
  const missed = c.bugs.filter((_, j) => owner[j] < 0).map((b) => b.id);
  return {
    id: c.id,
    bugs: c.bugs.length,
    findings: kept.length,
    tp: found.length,
    fp: falsePositives.length,
    fn: missed.length,
    duplicates,
    found,
    missed,
    falsePositives,
  };
}

export type Totals = {
  cases: number;
  bugs: number;
  findings: number;
  tp: number;
  fp: number;
  fn: number;
  duplicates: number;
  /** Null when there were no non-duplicate findings: precision is undefined, not 0 or 1. */
  precision: number | null;
  /** Null when the cases seed no bugs. */
  recall: number | null;
  f1: number | null;
  /** False positives on cases with no seeded bugs. */
  cleanCaseFalsePositives: number;
};

export function totals(scores: CaseScore[]): Totals {
  const sum = (k: "bugs" | "findings" | "tp" | "fp" | "fn" | "duplicates") => scores.reduce((n, s) => n + s[k], 0);
  const tp = sum("tp");
  const fp = sum("fp");
  const bugs = sum("bugs");
  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const recall = bugs > 0 ? tp / bugs : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return {
    cases: scores.length,
    bugs,
    findings: sum("findings"),
    tp,
    fp,
    fn: sum("fn"),
    duplicates: sum("duplicates"),
    precision,
    recall,
    f1,
    cleanCaseFalsePositives: scores.filter((s) => s.bugs === 0).reduce((n, s) => n + s.fp, 0),
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(1)}%`);

/** Markdown report: per-case table, then totals. */
export function renderReport(scores: CaseScore[], t: Totals, notes: string[] = []): string {
  const rows = scores.map(
    (s) =>
      `| ${s.id} | ${s.bugs} | ${s.findings} | ${s.tp} | ${s.fp} | ${s.fn} | ${s.missed.join(", ") || "—"} |`
  );
  return [
    "| case | bugs | findings | TP | FP | FN | missed |",
    "|---|---:|---:|---:|---:|---:|---|",
    ...rows,
    "",
    `**Precision ${pct(t.precision)}** (${t.tp}/${t.tp + t.fp}) · **Recall ${pct(t.recall)}** (${t.tp}/${t.bugs}) · F1 ${pct(t.f1)}`,
    `${t.cases} cases, ${t.findings} findings, ${t.duplicates} duplicate(s) not counted, ${t.cleanCaseFalsePositives} false positive(s) on clean cases.`,
    ...notes.map((n) => `> ${n}`),
  ].join("\n");
}

/** Validate a parsed case.json; throws naming the case and the field. */
export function parseCase(raw: any, where: string): BenchCase {
  const fail = (msg: string): never => {
    throw new Error(`${where}: ${msg}`);
  };
  if (!raw || typeof raw !== "object") fail("not a JSON object");
  if (typeof raw.id !== "string" || !raw.id) fail("missing id");
  if (!Array.isArray(raw.bugs)) fail("bugs must be an array");
  const ids = new Set<string>();
  for (const b of raw.bugs) {
    if (typeof b.id !== "string" || !b.id) fail("a bug is missing id");
    if (ids.has(b.id)) fail(`duplicate bug id ${b.id}`);
    ids.add(b.id);
    if (typeof b.file !== "string" || !b.file) fail(`${b.id}: missing file`);
    if (!Array.isArray(b.lines) || b.lines.length !== 2 || !b.lines.every((n: unknown) => Number.isInteger(n) && (n as number) > 0) || b.lines[0] > b.lines[1])
      fail(`${b.id}: lines must be [start, end] with 1 <= start <= end`);
    if (b.severity !== "high" && b.severity !== "medium") fail(`${b.id}: severity must be high or medium`);
    if (!Array.isArray(b.keywords) || b.keywords.length === 0) fail(`${b.id}: keywords must be a non-empty array`);
  }
  return {
    id: raw.id,
    language: String(raw.language ?? ""),
    description: String(raw.description ?? ""),
    bugs: raw.bugs,
  };
}
