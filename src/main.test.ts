import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPooled, getPrDiff, MAX_DIFF_FILES } from "./main.js";

describe("runPooled (issue #51)", () => {
  it("preserves result order regardless of completion order", async () => {
    const slow = (ms: number, v: number) => () => new Promise<number>((r) => setTimeout(() => r(v), ms));
    const out = await runPooled([slow(30, 1), slow(1, 2), slow(15, 3)], 3);
    assert.deepEqual(out, [1, 2, 3]);
  });

  it("never exceeds the concurrency limit", async () => {
    let inFlight = 0;
    let peak = 0;
    const task = () => () =>
      new Promise<number>((r) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        setTimeout(() => {
          inFlight--;
          r(1);
        }, 10);
      });
    const thunks = Array.from({ length: 12 }, task);
    const out = await runPooled(thunks, 3);
    assert.equal(out.length, 12);
    assert.ok(peak <= 3, `peak concurrency ${peak} exceeded the limit of 3`);
    assert.ok(peak > 1, "expected real concurrency, got a serial loop");
  });

  it("a limit of 1 serializes", async () => {
    let inFlight = 0;
    let peak = 0;
    const task = () => () =>
      new Promise<number>((r) => {
        inFlight++;
        peak = Math.max(peak, inFlight);
        setTimeout(() => {
          inFlight--;
          r(1);
        }, 5);
      });
    await runPooled(Array.from({ length: 5 }, task), 1);
    assert.equal(peak, 1);
  });

  it("limit above the task count is not a problem", async () => {
    const out = await runPooled([() => Promise.resolve("a"), () => Promise.resolve("b")], 99);
    assert.deepEqual(out, ["a", "b"]);
  });

  it("handles an empty task list", async () => {
    assert.deepEqual(await runPooled([], 4), []);
  });
});

describe("getPrDiff (issue #50)", () => {
  const fake = (files: { filename: string; patch?: string }[], headSha = "abc1234") => ({
    paginate: async () => files,
    rest: { pulls: { listFiles: () => {}, get: async () => ({ data: { head: { sha: headSha } } }) } },
  }) as any;

  it("paginates past 100 files instead of silently reviewing the first page", async () => {
    const files = Array.from({ length: 150 }, (_, i) => ({
      filename: `f${i}.ts`, patch: `@@ -1 +1 @@\n+x${i}`,
    }));
    const out = await getPrDiff(fake(files), "o", "r", 1, "deadbee");
    assert.equal(out.fileNames.length, 150);
    assert.equal(out.totalFiles, 150);
    assert.equal(out.truncated, false);
    assert.equal(out.headSha, "deadbee");
    assert.ok(out.diff.includes("f149.ts"));
  });

  it("reports binary/unrenderable files instead of silently dropping them", async () => {
    const out = await getPrDiff(
      fake([
        { filename: "a.ts", patch: "@@ -1 +1 @@\n+x" },
        { filename: "logo.png" },
        { filename: "huge.ts" },
      ]),
      "o", "r", 1, "deadbee"
    );
    assert.deepEqual(out.omitted, ["logo.png", "huge.ts"]);
    assert.ok(out.diff.includes("a.ts"));
    assert.ok(!out.diff.includes("logo.png"));
  });

  it("caps at MAX_DIFF_FILES and reports the truncation", async () => {
    const files = Array.from({ length: MAX_DIFF_FILES + 50 }, (_, i) => ({
      filename: `f${i}.ts`, patch: "@@ -1 +1 @@\n+x",
    }));
    const out = await getPrDiff(fake(files), "o", "r", 1, "deadbee");
    assert.equal(out.fileNames.length, MAX_DIFF_FILES);
    assert.equal(out.totalFiles, MAX_DIFF_FILES + 50);
    assert.equal(out.truncated, true);
  });

  it("falls back to pulls.get only when the payload sha is missing", async () => {
    let getCalls = 0;
    const ok = {
      paginate: async () => [{ filename: "a.ts", patch: "@@ -1 +1 @@\n+x" }],
      rest: {
        pulls: {
          listFiles: () => {},
          get: async () => { getCalls++; return { data: { head: { sha: "from-api" } } }; },
        },
      },
    } as any;
    const withPayload = await getPrDiff(ok, "o", "r", 1, "from-payload");
    assert.equal(withPayload.headSha, "from-payload");
    assert.equal(getCalls, 0);
    const withoutPayload = await getPrDiff(ok, "o", "r", 1, undefined);
    assert.equal(withoutPayload.headSha, "from-api");
    assert.equal(getCalls, 1);
  });
});
