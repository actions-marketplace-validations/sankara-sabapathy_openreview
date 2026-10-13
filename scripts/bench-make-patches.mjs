#!/usr/bin/env node
/**
 * Regenerate benchmark/cases/<id>/patch.diff from each case's before/ and
 * after/ trees.
 *
 * Run:  node scripts/bench-make-patches.mjs [case-id ...]
 *
 * The patch is written in the shape getPrDiff() builds from the GitHub API
 * (`--- a/<file>\n+++ b/<file>\n<hunks>`), so the benchmark feeds agents
 * exactly what a real PR review sees. Edit the sources, never the patch.
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const casesDir = fileURLToPath(new URL("../benchmark/cases/", import.meta.url));

function walk(root, dir = root, out = []) {
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name);
    if (e.isDirectory()) walk(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

function fileDiff(caseDir, file) {
  const before = join(caseDir, "before", file);
  const after = join(caseDir, "after", file);
  const args = ["diff", "--no-index", "--no-color", "-U3", "--",
    existsSync(before) ? before : "/dev/null", existsSync(after) ? after : "/dev/null"];
  let out;
  try {
    out = execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // git diff --no-index exits 1 when the files differ.
    if (e.status !== 1) throw e;
    out = e.stdout;
  }
  if (!out) return null;
  const hunks = out.slice(out.indexOf("\n@@") + 1).replace(/\n$/, "");
  return `--- a/${file}\n+++ b/${file}\n${hunks}`;
}

const only = process.argv.slice(2);
for (const id of readdirSync(casesDir).sort()) {
  if (only.length && !only.includes(id)) continue;
  const caseDir = join(casesDir, id);
  const files = [...new Set([...walk(join(caseDir, "before")), ...walk(join(caseDir, "after"))])].sort();
  const parts = files.map((f) => fileDiff(caseDir, f)).filter(Boolean);
  if (parts.length === 0) throw new Error(`${id}: before/ and after/ are identical`);
  writeFileSync(join(caseDir, "patch.diff"), parts.join("\n\n") + "\n");
  console.log(`${id}: ${parts.length} file(s)`);
}
