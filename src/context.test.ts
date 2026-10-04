import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, symlinkSync, rmSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { extractDefinedNames, buildContextBlock, buildRepoIndex, MAX_CALLER_SCAN_BYTES } from "./context.js";
import { combineBallots, decideReviewVerdict, matchesAny } from "./reviewer.js";
import { isRetryableError } from "./providers.js";

describe("extractDefinedNames", () => {
  it("finds exported TS symbols", () => {
    const names = extractDefinedNames(
      "export function foo() {}\nexport const bar = 1;\nclass Baz {}\nconst x = 1;"
    );
    assert.ok(names.includes("foo"));
    assert.ok(names.includes("bar"));
    assert.ok(names.includes("Baz"));
  });
  it("finds python/go defs", () => {
    const names = extractDefinedNames("def handler():\n  pass\nclass Model:\n  pass");
    assert.ok(names.includes("handler") && names.includes("Model"));
    assert.ok(extractDefinedNames("func Serve() {}").includes("Serve"));
  });
});

describe("buildContextBlock", () => {
  let dir: string;
  before(() => {
    dir = mkdtempSync(path.join(tmpdir(), "or-ctx-"));
    writeFileSync(path.join(dir, "real.ts"), "export function hello() { return 1; }\n");
    try {
      symlinkSync("/etc/hostname", path.join(dir, "evil.ts"));
    } catch {
      // symlinks unavailable on some platforms; related tests assert accordingly
    }
  });
  after(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("never follows symlinks", () => {
    const link = path.join(dir, "evil.ts");
    if (!existsSync(link)) return; // symlinks unavailable on this platform
    let targetContent = "";
    try {
      targetContent = readFileSync("/etc/hostname", "utf8").trim();
    } catch {
      // unreadable target; the exclusion assertion below still holds
    }
    const r = buildContextBlock({
      repoRoot: dir,
      scopedFiles: ["real.ts", "evil.ts"],
      contextFiles: [],
      includeFullFiles: true,
      maxContextChars: 20000,
      ignore: [],
    });
    assert.ok(!r.block.includes("full file: evil.ts"));
    if (targetContent) assert.ok(!r.block.includes(targetContent));
  });

  it("never escapes through a symlinked directory", () => {
    const outside = dir + "-outside";
    try {
      mkdirSync(outside, { recursive: true });
      writeFileSync(path.join(outside, "secret.txt"), "top-secret");
      symlinkSync(outside, path.join(dir, "linkdir"));
    } catch {
      return; // symlinks unavailable on this platform
    }
    try {
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["real.ts"],
        contextFiles: ["linkdir/secret.txt"],
        includeFullFiles: false,
        maxContextChars: 20000,
        ignore: [],
      });
      assert.ok(!r.block.includes("top-secret"));
      assert.ok(r.stats.includes("linkdir/secret.txt"));
    } finally {
      rmSync(outside, { recursive: true, force: true });
      rmSync(path.join(dir, "linkdir"), { force: true });
    }
  });

  it("warns on missing explicit context files", () => {
    const r = buildContextBlock({
      repoRoot: dir,
      scopedFiles: ["real.ts"],
      contextFiles: ["nope-missing.ts"],
      includeFullFiles: false,
      maxContextChars: 20000,
      ignore: [],
    });
    assert.ok(r.stats.includes("nope-missing.ts"));
  });

  it("zero budget disables", () => {
    const r = buildContextBlock({
      repoRoot: dir,
      scopedFiles: ["real.ts"],
      contextFiles: [],
      includeFullFiles: true,
      maxContextChars: 0,
      ignore: [],
    });
    assert.equal(r.block, "");
  });

  it("respects budget", () => {
    const r = buildContextBlock({
      repoRoot: dir,
      scopedFiles: ["real.ts"],
      contextFiles: [],
      includeFullFiles: true,
      maxContextChars: 500,
      ignore: [],
    });
    assert.ok(r.block.length <= 700);
  });
});

describe("ballots", () => {
  const v = (fs: { severity: "high" | "medium" | "suggestion" }[]) =>
    decideReviewVerdict("request_changes", "high", fs);
  it("any = most severe, all = unanimous, majority = median", () => {
    assert.equal(combineBallots([v([{ severity: "high" }]), v([])], "any"), "request_changes");
    assert.equal(combineBallots([v([{ severity: "high" }]), v([])], "all"), "approve");
    assert.equal(
      combineBallots([v([{ severity: "high" }]), v([])], "majority"),
      "request_changes"
    );
  });
});

describe("misc", () => {
  it("matchesAny globs", () => {
    assert.ok(matchesAny("src/a.ts", ["src/**"]));
    assert.ok(!matchesAny("src/a.ts", ["test/**"]));
  });
  it("retry classification", () => {
    assert.ok(isRetryableError("empty content from m"));
    assert.ok(isRetryableError("llm https://x 503: down"));
    assert.ok(!isRetryableError("llm https://x 401: bad key"));
  });
  it("formatTokens compacts", async () => {
    const { formatTokens } = await import("./providers.js");
    assert.equal(formatTokens(999), "999");
    assert.equal(formatTokens(12400), "12.4k");
  });
});

describe("noise controls", () => {
  it("presets resolve, explicit knobs win", async () => {
    const { resolveNoise } = await import("./reviewer.js");
    assert.deepEqual(resolveNoise({ profile: "quiet" }), { min_confidence: 0.85, max_findings: 3 });
    assert.deepEqual(resolveNoise({}), { min_confidence: 0, max_findings: 50 });
    assert.deepEqual(resolveNoise({ profile: "quiet", max_findings: 10 }), {
      min_confidence: 0.85,
      max_findings: 10,
    });
  });
  it("floor + cap + severity/confidence ordering", async () => {
    const { applyNoiseControls } = await import("./reviewer.js");
    type F = { severity: string; confidence: number };
    const H = (c: number): F => ({ severity: "high", confidence: c });
    const M = (c: number): F => ({ severity: "medium", confidence: c });
    const S = (c: number): F => ({ severity: "suggestion", confidence: c });
    const r = applyNoiseControls([S(0.9), H(0.5), M(0.95), H(0.9), S(0.2)], {
      min_confidence: 0.6,
      max_findings: 3,
    });
    assert.deepEqual(
      r.visible.map((f) => `${f.severity}:${f.confidence}`),
      ["high:0.9", "medium:0.95", "suggestion:0.9"]
    );
    assert.equal(r.dropped, 2);
  });
});

describe("logger", () => {
  it("redacts key material from headers", async () => {
    const { redactHeaders } = await import("./logger.js");
    const out = redactHeaders({
      authorization: "Bearer sk-ant-secret",
      "x-api-key": "sk-ant-secret",
      "X-Api-Key": "other-secret",
      "api-key": "azure-secret",
      "content-type": "application/json",
    });
    assert.equal(out["authorization"], "Bearer ***");
    assert.equal(out["x-api-key"], "***");
    assert.equal(out["X-Api-Key"], "***");
    assert.equal(out["api-key"], "***");
    assert.equal(out["content-type"], "application/json");
    assert.ok(!JSON.stringify(out).includes("secret"));
  });
  it("masks every token in multi-token values", async () => {
    const { redactHeaders } = await import("./logger.js");
    const out = redactHeaders({ authorization: "Bearer abc123 extra" });
    assert.equal(out["authorization"], "Bearer ***");
    assert.ok(!out["authorization"].includes("abc123"));
  });
  it("marks unset keys", async () => {
    const { redactHeaders } = await import("./logger.js");
    assert.equal(redactHeaders({ authorization: "" })["authorization"], "(not set)");
  });
});

describe("shared repo index (issue #55)", () => {
  it("one index serves two reviews with identical output, from cache", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      writeFileSync(path.join(dir, "b.ts"), "import { alpha } from './a';\nconsole.log(alpha());\n");
      const input = {
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [] as string[],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: [] as string[],
      };
      const index = buildRepoIndex(dir, []);
      assert.ok(index.files.includes("a.ts") && index.files.includes("b.ts"));
      const r1 = buildContextBlock(input, index);
      const r2 = buildContextBlock(input, index);
      assert.equal(r1.block, r2.block);
      assert.match(r1.block, /callers of alpha in b\.ts/);
      // Delete from disk: the second review-equivalent still resolves from cache.
      rmSync(path.join(dir, "b.ts"));
      const r3 = buildContextBlock(input, index);
      assert.equal(r3.block, r1.block);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips the caller scan when nothing is defined and reports no scan", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "plain.txt"), "just words, no symbols here\n");
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["plain.txt"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: [],
      });
      assert.ok(!r.stats.includes("scanned"), `unexpected scan: ${r.stats}`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bounds the caller scan by byte budget", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      // 100 files x 30KB of calling code: far more than the scan budget.
      const filler = "console.log(alpha());\n".repeat(1500);
      for (let i = 0; i < 100; i++) writeFileSync(path.join(dir, `c${i}.ts`), filler);
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 200000,
        ignore: [],
      });
      const m = /scanned ~(\d+)KB\/(\d+)KB/.exec(r.stats);
      assert.ok(m, `stats must report the scan: ${r.stats}`);
      assert.ok(Number(m[1]) <= Number(m[2]), `scan ${m[1]}KB exceeded budget ${m[2]}KB`);
      assert.equal(Number(m[2]), Math.round(MAX_CALLER_SCAN_BYTES / 1024));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("excerpt line numbers stay exact on deep matches", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      const pad = Array.from({ length: 50 }, (_, i) => `// filler ${i}`).join("\n");
      writeFileSync(path.join(dir, "b.ts"), `${pad}\nconst x = alpha();\n`);
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: false,
        maxContextChars: 20000,
        ignore: [],
      });
      assert.match(r.block, /51: const x = alpha\(\);/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("walk nesting (issue #55)", () => {
  it("returns nested files with their directory prefix", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      mkdirSync(path.join(dir, "sub", "deep"), { recursive: true });
      writeFileSync(path.join(dir, "top.ts"), "export const t = 1;\n");
      writeFileSync(path.join(dir, "sub", "nested.ts"), "export function nested() { return 2; }\n");
      writeFileSync(path.join(dir, "sub", "deep", "leaf.ts"), "const caller = nested();\n");
      const index = buildRepoIndex(dir, []);
      assert.ok(index.files.includes("top.ts"));
      assert.ok(index.files.includes("sub/nested.ts"), `got: ${index.files.join(",")}`);
      assert.ok(index.files.includes("sub/deep/leaf.ts"));
      // Caller excerpts now resolve across directories.
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["sub/nested.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: [],
      }, index);
      assert.match(r.block, /callers of nested in sub\/deep\/leaf\.ts/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dogfood round 2 (issue #55)", () => {
  it("counts multibyte sources in true bytes", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      // 1000 CJK chars ≈ 3000 bytes but only 1000 UTF-16 units.
      writeFileSync(path.join(dir, "b.ts"), "const x = alpha(); // 注释填充\n" + "汉".repeat(1000) + "\n");
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: [],
      });
      const m = /scanned ~(\d+)KB\/\d+KB/.exec(r.stats);
      assert.ok(m, `stats must report the scan: ${r.stats}`);
      assert.ok(Number(m[1]) >= 3, `expected ~3KB+ of true bytes, got ${m[1]}KB`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("a shared index still honors the caller's own ignore", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      writeFileSync(path.join(dir, "keep.ts"), "const x = alpha();\n");
      writeFileSync(path.join(dir, "skip.gen.ts"), "const y = alpha();\n");
      const index = buildRepoIndex(dir, []);
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: ["*.gen.ts"],
      }, index);
      assert.match(r.block, /keep\.ts/);
      assert.ok(!r.block.includes("skip.gen.ts"), "ignored file leaked into excerpts");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("dogfood round 3 (issue #55)", () => {
  it("scan never exceeds the byte budget, even for multibyte tails", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "or-idx-"));
    try {
      writeFileSync(path.join(dir, "a.ts"), "export function alpha() { return 1; }\n");
      // 20 files x 60KB chars of CJK ≈ 180KB bytes each: 3.6MB total.
      const big = ("const v = alpha(); // 汉\n" + "汉".repeat(20000) + "\n").repeat(3).slice(0, 60000);
      for (let i = 0; i < 20; i++) writeFileSync(path.join(dir, `c${i}.ts`), big);
      const r = buildContextBlock({
        repoRoot: dir,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 500000,
        ignore: [],
      });
      const m = /scanned ~(\d+)KB\/(\d+)KB/.exec(r.stats);
      assert.ok(m, `stats must report the scan: ${r.stats}`);
      assert.ok(Number(m[1]) <= Number(m[2]), `scan ${m[1]}KB exceeded budget ${m[2]}KB`);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an index built for another root is not trusted", () => {
    const dirA = mkdtempSync(path.join(tmpdir(), "or-idxA-"));
    const dirB = mkdtempSync(path.join(tmpdir(), "or-idxB-"));
    try {
      writeFileSync(path.join(dirA, "a.ts"), "WRONG REPO CONTENT\n");
      writeFileSync(path.join(dirB, "a.ts"), "export function alpha() { return 1; }\n");
      const foreign = buildRepoIndex(dirA, []);
      const r = buildContextBlock({
        repoRoot: dirB,
        scopedFiles: ["a.ts"],
        contextFiles: [],
        includeFullFiles: true,
        maxContextChars: 20000,
        ignore: [],
      }, foreign);
      assert.ok(!r.block.includes("WRONG REPO CONTENT"));
      assert.match(r.block, /alpha/);
    } finally {
      rmSync(dirA, { recursive: true, force: true });
      rmSync(dirB, { recursive: true, force: true });
    }
  });
});
