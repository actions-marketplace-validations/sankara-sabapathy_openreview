export function matchesAny(path: string, patterns: string[]): boolean {
  if (patterns.length === 0) return true;
  return patterns.some((p) => matchGlob(path, p));
}

// Minimal glob: supports **, *, exact. Good enough for path scoping without deps.
export function matchGlob(path: string, pattern: string): boolean {
  if (pattern === "**" || pattern === "**/**") return true;
  const rx = pattern
    .split("/")
    .map((seg) => {
      if (seg === "**") return ".*";
      return (
        "(?:" +
        seg.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") +
        ")"
      );
    })
    .join("/");
  return new RegExp(`^${rx}$`).test(path);
}

export function filterIgnored(files: string[], ignore: string[]): string[] {
  if (!ignore.length) return files;
  return files.filter((f) => !ignore.some((p) => matchGlob(f, p)));
}

export function dedupeFindings<T extends { file: string; line?: number; comment: string }>(
  findings: T[]
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const f of findings) {
    const k = `${f.file}:${f.line ?? 0}:${f.comment.slice(0, 80)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}

export type Verdict = "approve" | "comment" | "request_changes";

export function decideReviewVerdict(
  mode: Verdict,
  minSeverity: "suggestion" | "medium" | "high",
  findings: { severity: "high" | "medium" | "suggestion" }[]
): Verdict {
  const rank = { suggestion: 0, medium: 1, high: 2 } as const;
  const need = rank[minSeverity];
  const hasBlocking = findings.some((f) => rank[f.severity] >= need);
  if (!hasBlocking) return "approve";
  return mode;
}

export function combineVerdicts(
  verdicts: Verdict[],
  strategy: "any_blocking" | "max_severity" | "majority"
): Verdict {
  if (verdicts.length === 0) return "comment";
  if (strategy === "majority") {
    const counts = new Map<Verdict, number>();
    for (const v of verdicts) counts.set(v, (counts.get(v) ?? 0) + 1);
    let best: Verdict = "comment";
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    return best;
  }
  // any_blocking + max_severity behave the same on verdict enums
  if (verdicts.includes("request_changes")) return "request_changes";
  if (verdicts.includes("comment")) return "comment";
  return "approve";
}
