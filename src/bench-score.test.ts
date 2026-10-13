import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { findingMatchesBug, scoreCase, totals, parseCase, type BenchCase, type ExpectedBug } from "./bench-score.js";
import { splitDiff, parseHunkRanges } from "./reviewer.js";

const bug = (over: Partial<ExpectedBug> = {}): ExpectedBug => ({
  id: "b1",
  file: "src/a.ts",
  lines: [10, 12],
  severity: "high",
  summary: "",
  keywords: ["injection"],
  ...over,
});
const f = (line: number | undefined, comment = "x", file = "src/a.ts", severity: "high" | "medium" | "suggestion" = "high") => ({
  file, line, comment, severity,
});
const opts = { tolerance: 3, minSeverity: "suggestion" as const };

describe("findingMatchesBug", () => {
  it("matches inside the range plus tolerance, not beyond", () => {
    assert.equal(findingMatchesBug(f(7), bug(), 3), true);
    assert.equal(findingMatchesBug(f(15), bug(), 3), true);
    assert.equal(findingMatchesBug(f(16), bug(), 3), false);
    assert.equal(findingMatchesBug(f(6), bug(), 3), false);
  });

  it("requires the same file, ignoring a/ b/ ./ prefixes", () => {
    assert.equal(findingMatchesBug(f(11, "x", "src/b.ts"), bug(), 3), false);
    assert.equal(findingMatchesBug(f(11, "x", "b/src/a.ts"), bug(), 3), true);
    assert.equal(findingMatchesBug(f(11, "x", "./src/a.ts"), bug(), 3), true);
  });

  it("uses keywords only when the finding has no line", () => {
    assert.equal(findingMatchesBug(f(undefined, "SQL Injection here"), bug(), 3), true);
    assert.equal(findingMatchesBug(f(undefined, "style nit"), bug(), 3), false);
    // A line far away is a claim about other code, keywords do not rescue it.
    assert.equal(findingMatchesBug(f(40, "SQL injection"), bug(), 3), false);
  });
});

describe("scoreCase", () => {
  const twoBugs: BenchCase = {
    id: "c", language: "ts", description: "",
    bugs: [bug({ id: "a", lines: [10, 10] }), bug({ id: "b", lines: [14, 14] })],
  };

  it("counts TP, FP, FN and duplicates", () => {
    const s = scoreCase(twoBugs, [f(10), f(10, "again"), f(50)], opts);
    assert.deepEqual([s.tp, s.fp, s.fn, s.duplicates], [1, 1, 1, 1]);
    assert.deepEqual(s.found, ["a"]);
    assert.deepEqual(s.missed, ["b"]);
  });

  it("assigns by maximum matching, so an ambiguous finding cannot starve a precise one", () => {
    // Line 13 is within tolerance of both bugs, line 9 only of a. First-fit
    // would credit 13 -> a and call the precise line-9 finding a duplicate.
    const s = scoreCase(twoBugs, [f(13), f(9)], { tolerance: 3, minSeverity: "suggestion" });
    assert.equal(s.tp, 2);
    assert.equal(s.duplicates, 0);
  });

  it("drops findings below minSeverity before scoring", () => {
    const s = scoreCase(twoBugs, [f(10, "x", "src/a.ts", "suggestion"), f(14)], { tolerance: 0, minSeverity: "medium" });
    assert.deepEqual([s.findings, s.tp, s.fn], [1, 1, 1]);
  });

  it("every finding on a clean case is a false positive", () => {
    const clean: BenchCase = { id: "clean", language: "ts", description: "", bugs: [] };
    const s = scoreCase(clean, [f(1), f(2)], opts);
    assert.deepEqual([s.tp, s.fp, s.fn], [0, 2, 0]);
  });
});

describe("totals", () => {
  it("reports null, not 0 or 1, when a ratio is undefined", () => {
    const clean: BenchCase = { id: "clean", language: "ts", description: "", bugs: [] };
    const t = totals([scoreCase(clean, [], opts)]);
    assert.equal(t.precision, null);
    assert.equal(t.recall, null);
    assert.equal(t.f1, null);
  });

  it("computes precision, recall and F1 across cases", () => {
    const c: BenchCase = { id: "c", language: "ts", description: "", bugs: [bug({ id: "a" }), bug({ id: "b", lines: [40, 40] })] };
    const clean: BenchCase = { id: "clean", language: "ts", description: "", bugs: [] };
    const t = totals([scoreCase(c, [f(11)], opts), scoreCase(clean, [f(1)], opts)]);
    assert.equal(t.precision, 0.5);
    assert.equal(t.recall, 0.5);
    assert.equal(t.f1, 0.5);
    assert.equal(t.cleanCaseFalsePositives, 1);
  });
});

describe("parseCase", () => {
  it("rejects malformed bugs with the case named", () => {
    assert.throws(() => parseCase({ id: "x", bugs: [{ ...bug(), lines: [5, 2] }] }, "x/case.json"), /x\/case\.json: b1: lines/);
    assert.throws(() => parseCase({ id: "x", bugs: [bug(), bug()] }, "x/case.json"), /duplicate bug id/);
    assert.throws(() => parseCase({ id: "x", bugs: [{ ...bug(), severity: "suggestion" }] }, "x/case.json"), /severity/);
  });
});

describe("benchmark fixtures", () => {
  it("every seeded bug sits on a line the patch actually changes or shows", (t) => {
    const here = dirname(fileURLToPath(import.meta.url));
    const casesDir = join(here, "../benchmark/cases");
    // Explicit skip, never a silent pass (same rule as the config guard test).
    if (!existsSync(casesDir)) {
      t.skip("no benchmark/cases next to the built tests");
      return;
    }
    const ids = readdirSync(casesDir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
    assert.ok(ids.length >= 10, `expected a real benchmark, found ${ids.length} cases`);
    let clean = 0;
    for (const id of ids) {
      const dir = join(casesDir, id);
      const c = parseCase(JSON.parse(readFileSync(join(dir, "case.json"), "utf8")), `${id}/case.json`);
      assert.equal(c.id, id, `${id}: case.json id must match its directory`);
      if (c.bugs.length === 0) clean++;
      const patches = new Map(splitDiff(readFileSync(join(dir, "patch.diff"), "utf8")).map((p) => [p.file, p.patch]));
      assert.ok(patches.size > 0, `${id}: patch.diff has no file patches`);
      for (const b of c.bugs) {
        const patch = patches.get(b.file);
        assert.ok(patch, `${id}/${b.id}: ${b.file} is not in patch.diff`);
        const ranges = parseHunkRanges(patch);
        for (let line = b.lines[0]; line <= b.lines[1]; line++)
          assert.ok(
            ranges.some((r) => line >= r.start && line <= r.end),
            `${id}/${b.id}: line ${line} is outside every hunk of ${b.file}`
          );
        assert.ok(existsSync(join(dir, "after", b.file)), `${id}/${b.id}: after/${b.file} missing (context source)`);
      }
    }
    assert.ok(clean >= 1, "benchmark needs at least one clean case to measure false positives");
  });
});
