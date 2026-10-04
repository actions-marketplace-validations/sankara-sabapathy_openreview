import { readFileSync, readdirSync, statSync, realpathSync, type Dirent } from "node:fs";
import * as path from "node:path";
import * as core from "@actions/core";
import { logInfo, logWarning } from "./logger.js";
import { matchesAny } from "./reviewer.js";

const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "dist",
  "dist-src",
  "website/build",
  ".docusaurus",
  "coverage",
  ".next",
  "vendor",
  "__pycache__",
]);

const SKIP_EXT = new Set([
  ".lock",
  ".snap",
  ".map",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".pdf",
  ".zip",
  ".woff",
  ".woff2",
  ".ttf",
  ".ico",
]);

export type ContextInput = {
  repoRoot: string;
  scopedFiles: string[]; // changed, in-scope files for this review
  contextFiles: string[]; // extra globs from review config
  includeFullFiles: boolean;
  maxContextChars: number;
  ignore: string[];
};

function walkFiles(root: string, ignore: string[], out: string[] = []): string[] {
  return walkInto(root, root, ignore, out);
}

function walkInto(top: string, dir: string, ignore: string[], out: string[]): string[] {
  let entries: Dirent[];
  try {
    // withFileTypes: symlink/dir/file kinds come free with the listing, so
    // one readdir replaces the old lstat + stat + stat-per-size round trips.
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    // Never descend into or through symlinks: the Dirent kind is lstat
    // information, so a symlinked intermediate directory can never escape.
    if (e.isSymbolicLink()) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      walkInto(top, full, ignore, out);
    } else if (e.isFile()) {
      // Paths are repo-relative from the walk ROOT (not the recursion level):
      // computing them against `dir` flattened every nested file to a bare
      // name, so candidate reads silently missed on any repo with
      // subdirectories (issue #55).
      const rel = path.relative(top, full).replace(/\\/g, "/");
      if (SKIP_EXT.has(path.extname(e.name))) continue;
      if (ignore.length > 0 && matchesAny(rel, ignore)) continue;
      try {
        if (statSync(full).size > 200_000) continue; // skip huge files
      } catch {
        continue;
      }
      out.push(rel);
    }
  }
  return out;
}

function readCapped(root: string, rel: string, cap: number): string | null {
  const full = path.resolve(root, rel);
  // Containment on the REAL path (resolves symlinked intermediate dirs too, and
  // the root itself — e.g. /tmp -> /private/tmp on macOS):
  // never read outside the repo (config + file list are PR-controlled).
  let realRoot: string;
  try {
    realRoot = realpathSync(path.resolve(root));
  } catch {
    return null;
  }
  let real: string;
  try {
    real = realpathSync(full);
  } catch {
    return null;
  }
  const normRoot = realRoot + path.sep;
  if (real !== realRoot && !real.startsWith(normRoot)) return null;
  try {
    const content = readFileSync(real, "utf8");
    return content.length > cap ? content.slice(0, cap) + "\n...[file truncated]" : content;
  } catch {
    return null;
  }
}

// Top-level defined names: export function|const|class|interface|type X,
// def X / class X (python), ^func X (go), ^(public|private)? (class|function) X (php/java-ish).
const DEF_RES = [
  /export\s+(?:async\s+)?(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
  /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
  /^(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/gm,
  /^def\s+([A-Za-z_]\w*)/gm,
  /^class\s+([A-Za-z_]\w*)/gm,
  /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)/gm,
];

export function extractDefinedNames(content: string, limit = 20): string[] {
  const names = new Set<string>();
  for (const re of DEF_RES) {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null && names.size < limit) {
      if (m[1].length >= 3) names.add(m[1]);
    }
  }
  return [...names];
}

function isCommentLine(line: string): boolean {
  // Conservative: only unambiguous full-line comments. Prefixes like # -- %
  // are deliberately NOT treated as comments (C preprocessor, --count, 100%).
  // Missing a caller for precision is worse than an extra excerpt here, so
  // Python # comments may still match — acceptable noise.
  const t = line.trimStart();
  return t.startsWith("//") || t.startsWith("/*") || t.startsWith("*");
}

/** Char offset where each line begins. Computed once per file content;
 * every line lookup below is a binary search instead of a full split. */
function lineStarts(content: string): number[] {
  const starts = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function lineAtStarts(starts: number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Line text without the trailing newline (keeps \r, exactly like split("\n")). */
function lineText(content: string, starts: number[], line: number): string {
  const end = line + 1 < starts.length ? starts[line + 1] - 1 : content.length;
  return content.slice(starts[line], end);
}

/** Find up to `tries` code (non-comment) matches of word, returning char indices. */
function findCodeMatches(content: string, word: RegExp, tries = 6): number[] {
  const out: number[] = [];
  const starts = lineStarts(content);
  const g = new RegExp(word.source, "g");
  let m: RegExpExecArray | null;
  let guard = 0;
  while ((m = g.exec(content)) !== null && out.length < tries && guard++ < 200) {
    const line = lineAtStarts(starts, m.index);
    if (line >= 0 && !isCommentLine(lineText(content, starts, line))) out.push(m.index);
    if (m.index === g.lastIndex) g.lastIndex++; // avoid zero-width stall
  }
  return out;
}

function excerptAround(content: string, index: number, radius = 5): string {
  const starts = lineStarts(content);
  const i = lineAtStarts(starts, index);
  const lineCount = starts.length;
  const from = Math.max(0, i - radius);
  const to = Math.min(lineCount, i + radius + 1);
  const out: string[] = [];
  for (let k = from; k < to; k++) out.push(`${k + 1}: ${lineText(content, starts, k)}`);
  return out.join("\n");
}

/**
 * Repo-wide file listing + read cache, built ONCE per run and shared by every
 * review's context builder (issue #55). The walk used to repeat per review
 * and every candidate file was re-read per review; now both happen once.
 *
 * The walk-time `ignore` is a floor: a later call may narrow with its own
 * `input.ignore`, but files excluded at walk time cannot come back.
 */
export type RepoIndex = {
  root: string;
  files: string[];
  /** readCapped results keyed `${rel}|${cap}` (string|null). */
  cache: Map<string, string | null>;
};

export function buildRepoIndex(repoRoot: string, ignore: string[]): RepoIndex {
  return { root: repoRoot, files: walkFiles(repoRoot, ignore), cache: new Map() };
}

function readCached(index: RepoIndex | undefined, root: string, rel: string, cap: number): string | null {
  if (!index) return readCapped(root, rel, cap);
  const key = `${rel}|${cap}`;
  if (!index.cache.has(key)) index.cache.set(key, readCapped(root, rel, cap));
  return index.cache.get(key) ?? null;
}

/** Total bytes the caller-excerpt scan may read per buildContextBlock call
 * (issue #55). The old code read up to 400 files × 60KB ≈ 24MB per review;
 * excerpt hunting is best-effort, so cap the scan and spend the char budget
 * on excerpts that were actually found. */
export const MAX_CALLER_SCAN_BYTES = 2_000_000;

/**
 * Build a <context> block: full changed files + extra globs + call-site
 * excerpts for top-level symbols defined in changed files. Bounded by budget.
 *
 * Pass a RepoIndex built once per run to share the walk + reads across
 * reviews; without one a private index is built for the call (same output,
 * repeated work — fine for tests and single-review runs).
 */
export function buildContextBlock(input: ContextInput, repoIndex?: RepoIndex): { block: string; stats: string } {
  const budget = input.maxContextChars;
  if (budget <= 0) {
    const stats = "context: disabled (max_context_chars <= 0)";
    logInfo(stats);
    return { block: "", stats };
  }
  const parts: string[] = [];
  let used = 0;
  // Account for "\n\n" separators + "<context>\n" / "\n</context>" wrapper (21 chars
  // total) so the final prompt never exceeds the budget.
  const WRAPPER_OVERHEAD = 21;
  const push = (text: string): boolean => {
    const cost = text.length + 2; // part + separator
    if (used + cost + WRAPPER_OVERHEAD > budget) {
      // Truncate instead of dropping when a useful chunk would fit.
      const room = budget - used - WRAPPER_OVERHEAD - 2 - 24;
      if (room > 200) {
        const cut = text.slice(0, room) + "\n...[part truncated]";
        parts.push(cut);
        used += cut.length + 2;
        return true;
      }
      return false;
    }
    parts.push(text);
    used += cost;
    return true;
  };
  const pushed = new Set<string>(); // files actually in the prompt (differs from read set)

  let fullCount = 0;
  let extraCount = 0;
  let callerCount = 0;
  const warnings: string[] = [];

  // 1. Full content of changed in-scope files. A shared index built for
  // another root must not serve its cache here (both are exported): verify
  // first, fall back to direct reads on mismatch (dogfood on #74).
  const indexUsable =
    !!repoIndex && path.resolve(repoIndex.root) === path.resolve(input.repoRoot);
  if (repoIndex && !indexUsable)
    logWarning("context: shared index root mismatch, rebuilt privately");
  const changedContents = new Map<string, string>();
  if (input.includeFullFiles) {
    for (const f of input.scopedFiles) {
      const content = readCached(indexUsable ? repoIndex : undefined, input.repoRoot, f, 12000);
      if (content === null) continue;
      changedContents.set(f, content);
      if (push(`--- full file: ${f} ---\n${content}`)) {
        fullCount++;
        pushed.add(f);
      } else break;
    }
  } else {
    for (const f of input.scopedFiles) {
      const content = readCached(indexUsable ? repoIndex : undefined, input.repoRoot, f, 12000);
      if (content !== null) changedContents.set(f, content);
    }
  }

  // Defined names across all changed files, computed once: the caller scan
  // below is per-name, not per-(file × name).
  const definedNames = [...new Set([...changedContents.values()].flatMap((c) => extractDefinedNames(c)))];

  // Single repo walk reused by extras + callers (was up to 3 walks before,
  // and one walk per review before the shared index). Skipped entirely when
  // there is nothing to trace: no context_files and no defined names.
  // The caller's own `ignore` always applies on top of the walk-time one, so
  // a shared index never smuggles ignored files into a review (dogfood #74).
  const needWalk = input.contextFiles.length > 0 || definedNames.length > 0;
  const index = indexUsable ? repoIndex : needWalk ? buildRepoIndex(input.repoRoot, input.ignore) : undefined;
  // Seed a privately built index with the step-1 reads so later steps hit
  // cache instead of re-reading the same files within this call.
  if (index && index !== repoIndex) {
    for (const [f, c] of changedContents) index.cache.set(`${f}|12000`, c);
  }
  const walked = index?.files ?? [];
  const all = input.ignore.length > 0 ? walked.filter((f) => !matchesAny(f, input.ignore)) : walked;

  // 2. Extra context_files: explicit paths read directly (never silently dropped
  // by walk filters); globs resolved through the walk.
  if (input.contextFiles.length > 0) {
    const matched = new Set<string>();
    for (const pattern of input.contextFiles) {
      const isGlob = /[*?[\]{}!]/.test(pattern);
      if (!isGlob) {
        const direct = readCached(index, input.repoRoot, pattern, 8000);
        if (direct !== null) {
          if (!pushed.has(pattern) && !matched.has(pattern)) {
            matched.add(pattern);
            if (push(`--- context file: ${pattern} ---\n${direct}`)) {
              extraCount++;
              pushed.add(pattern);
            }
          }
        } else {
          warnings.push(`context_files: '${pattern}' not found or unreadable`);
        }
        continue;
      }
      for (const f of all) {
        if (matched.size >= 10) break;
        if (matchesAny(f, [pattern]) && !pushed.has(f) && !matched.has(f)) {
          const content = readCached(index, input.repoRoot, f, 8000);
          if (content === null) continue;
          matched.add(f);
          if (push(`--- context file: ${f} ---\n${content}`)) {
            extraCount++;
            pushed.add(f);
          } else break;
        }
      }
    }
  }

  // 3. Call-site excerpts for defined symbols. Changed files are never caller
  // candidates (their content is already in the prompt or the diff); each file
  // is emitted at most once. Candidate reads go through the shared cache and
  // stop at MAX_CALLER_SCAN_BYTES — the scan is best-effort, not exhaustive.
  let scannedBytes = 0;
  if (definedNames.length > 0) {
    const candidates = all
      .filter((f) => !changedContents.has(f) && !pushed.has(f))
      .slice(0, 400);
    const emitted = new Set<string>();
    for (const name of definedNames) {
      const word = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
      for (const other of candidates) {
        if (emitted.has(other)) continue;
        const remaining = MAX_CALLER_SCAN_BYTES - scannedBytes;
        if (remaining <= 0) break;
        // Clamp the read to what is left AND truncate the scan to it: the
        // cap alone is in chars, so a multibyte tail could otherwise overshoot
        // the byte budget by up to a whole file (dogfood on #74). A cut
        // multibyte char at the boundary is acceptable in best-effort excerpts.
        const raw = readCached(index, input.repoRoot, other, Math.min(60000, remaining)) ?? "";
        const buf = Buffer.from(raw, "utf8").subarray(0, remaining);
        const otherContent = buf.toString("utf8");
        scannedBytes += buf.length;
        const hits = findCodeMatches(otherContent, word, 2);
        if (hits.length > 0) {
          const excerpt = excerptAround(otherContent, hits[0]);
          if (push(`--- callers of ${name} in ${other} ---\n${excerpt}`)) {
            callerCount++;
            emitted.add(other);
          } else break;
        }
        if (callerCount >= 12) break;
      }
      if (used >= budget || callerCount >= 12 || scannedBytes >= MAX_CALLER_SCAN_BYTES) break;
    }
  }

  let stats = `context: ${fullCount} full files, ${extraCount} extra files, ${callerCount} caller excerpts, ${used}/${budget} chars`;
  if (definedNames.length > 0)
    stats += `; scanned ~${Math.round(scannedBytes / 1024)}KB/${Math.round(MAX_CALLER_SCAN_BYTES / 1024)}KB`;
  if (warnings.length > 0) {
    stats += `; warnings: ${warnings.join("; ")}`;
    for (const w of warnings) logWarning(`context: ${w}`);
  }
  logInfo(stats);
  if (parts.length === 0) return { block: "", stats };
  return { block: `<context>\n${parts.join("\n\n")}\n</context>`, stats };
}
