import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { renderStickyBody, upsertStickyComment, createInlineReview, STICKY_MARKER } from "./github.js";
import { countsAsReview, type AgentOutcome } from "./providers.js";

const base = { findings: [], runUrl: "https://example.test/run/1" };

describe("renderStickyBody (issue #46)", () => {
  it("a fully failed run says REVIEW FAILED, never approve or 'nice work'", () => {
    const body = renderStickyBody({
      ...base,
      verdict: "comment",
      status: "error",
      perReview: [{ id: "general-quality", verdict: "approve", count: 0, counted: false }],
      agents: [
        {
          review: "general-quality",
          agent: "general-quality:main",
          provider: "opencode",
          outcome: "error",
          seconds: 12,
        },
      ],
    });
    assert.match(body, /REVIEW FAILED/);
    assert.doesNotMatch(body, /APPROVE/);
    assert.doesNotMatch(body, /Nice work/);
    assert.match(body, /not reviewed/);
    assert.match(body, /No review completed/);
  });

  it("a partial run names the reviews that did not vote", () => {
    const body = renderStickyBody({
      ...base,
      verdict: "comment",
      status: "partial",
      perReview: [
        { id: "general-quality", verdict: "comment", count: 2, counted: true },
        { id: "security-strict", verdict: "approve", count: 0, counted: false },
      ],
      agents: [
        { review: "general-quality", agent: "main", provider: "opencode", outcome: "ok", seconds: 8 },
        {
          review: "security-strict",
          agent: "sec:main",
          provider: "codex",
          outcome: "skipped-no-key",
          seconds: 0,
        },
      ],
    });
    assert.match(body, /Partial review/);
    assert.match(body, /security-strict/);
    assert.match(body, /skipped \(no key\)/);
    assert.match(body, /APPROVE|REQUEST_CHANGES|COMMENT/);
  });

  it("a clean run still says nice work", () => {
    const body = renderStickyBody({
      ...base,
      verdict: "approve",
      status: "ok",
      perReview: [{ id: "general-quality", verdict: "approve", count: 0, counted: true }],
    });
    assert.match(body, /APPROVE/);
    assert.match(body, /Nice work/);
    assert.doesNotMatch(body, /REVIEW FAILED/);
  });

  it("always emits the sticky marker and the agent table", () => {
    const body = renderStickyBody({
      ...base,
      verdict: "comment",
      status: "ok",
      perReview: [{ id: "r", verdict: "comment", count: 0, counted: true }],
      agents: [{ review: "r", agent: "a", provider: "p", outcome: "ok", seconds: 1.25 }],
    });
    assert.ok(body.startsWith(STICKY_MARKER));
    assert.match(body, /<details><summary>🤖 1 agent\(s\)/);
    assert.match(body, /✅ reviewed/);
  });

  it("escapes pipes in comments and lists findings", () => {
    const body = renderStickyBody({
      ...base,
      verdict: "comment",
      status: "ok",
      perReview: [{ id: "r", verdict: "comment", count: 1, counted: true }],
      findings: [
        {
          file: "src/a.ts",
          line: 4,
          severity: "high",
          category: "bug",
          comment: "a | b | c",
          agent: "main",
          provider: "opencode",
        },
      ],
    });
    assert.match(body, /a \\\| b \\\| c/);
    assert.match(body, /`src\/a\.ts:4`/);
  });
});

describe("countsAsReview", () => {
  it("only ok / no-findings may vote", () => {
    const voting: AgentOutcome[] = ["ok", "no-findings"];
    // budget-exhausted must be here too: the dogfood review on #63 flagged that
  // it was missing from this list (it was already excluded by the function).
  const nonVoting: AgentOutcome[] = ["skipped-no-key", "budget-exhausted", "unparseable", "error"];
    for (const o of voting) assert.equal(countsAsReview(o), true, `${o} should vote`);
    for (const o of nonVoting) assert.equal(countsAsReview(o), false, `${o} must not vote`);
  });
});
describe("upsertStickyComment (issue #53)", () => {
  const sticky = `${STICKY_MARKER}\nbody`;
  const mock = (comments: any[], calls: any) => ({
    paginate: async () => comments,
    rest: {
      issues: {
        listComments: () => {},
        updateComment: async (p: any) => { calls.updated = p; },
        createComment: async (p: any) => { calls.created = p; },
      },
      pulls: { createReview: async () => {} },
    },
  }) as any;

  it("updates the bot's first-line-marker comment", async () => {
    const calls: any = {};
    await upsertStickyComment(
      mock([{ id: 1, user: { type: "Bot" }, body: sticky }], calls),
      "o", "r", 7, sticky
    );
    assert.equal(calls.updated.comment_id, 1);
    assert.equal(calls.created, undefined);
  });

  it("ignores a marker buried mid-body and a non-bot marker", async () => {
    const calls: any = {};
    await upsertStickyComment(
      mock(
        [
          { id: 1, user: { type: "User" }, body: `${STICKY_MARKER}\nspoof` },
          { id: 2, user: { type: "Bot" }, body: `hello ${STICKY_MARKER} bye` },
        ],
        calls
      ),
      "o", "r", 7, sticky
    );
    assert.equal(calls.updated, undefined);
    assert.ok(calls.created, "must create, not hijack");
  });

  it("finds the sticky past the first page via pagination", async () => {
    const calls: any = {};
    const many = Array.from({ length: 150 }, (_, i) => ({
      id: 100 + i, user: { type: "User" }, body: `comment ${i}`,
    }));
    many.push({ id: 999, user: { type: "Bot" }, body: sticky });
    await upsertStickyComment(mock(many, calls), "o", "r", 7, sticky);
    assert.equal(calls.updated.comment_id, 999);
  });
});

describe("createInlineReview (issue #53)", () => {
  const ranges = new Map([
    ["src/a.ts", [{ start: 10, end: 14 }]],
    ["src/b.ts", [{ start: 1, end: 3 }]],
  ]);
  const mock = (calls: any) => ({
    rest: { pulls: { createReview: async (p: any) => { calls.review = p; } } },
  }) as any;

  it("a bogus path/line never drops the good findings", async () => {
    const calls: any = {};
    const res = await createInlineReview(
      mock(calls), "o", "r", 1, "sha", "comment",
      [
        { file: "src/a.ts", line: 12, comment: "good" },
        { file: "nope.ts", line: 5, comment: "bogus path" },
        { file: "src/a.ts", line: 999, comment: "bogus line" },
      ],
      ranges
    );
    assert.deepEqual(res, { posted: 1, dropped: 2 });
    assert.equal(calls.review.comments.length, 1);
    assert.equal(calls.review.comments[0].path, "src/a.ts");
  });

  it("line-less findings ride in the body instead of vanishing", async () => {
    const calls: any = {};
    const res = await createInlineReview(
      mock(calls), "o", "r", 1, "sha", "comment",
      [{ file: "src/a.ts", comment: "file-level note" }],
      ranges
    );
    assert.deepEqual(res, { posted: 0, dropped: 0 });
    assert.match(calls.review.body, /File-level notes/);
    assert.match(calls.review.body, /src\/a\.ts/);
  });
});

describe("createInlineReview cap handling (dogfood on #73)", () => {
  const ranges = new Map([["src/a.ts", [{ start: 1, end: 100 }]]]);
  const mock = (calls: any) => ({
    rest: { pulls: { createReview: async (p: any) => { calls.review = p; } } },
  }) as any;

  it("scans past the 20-comment cap: later drops still counted, file notes kept", async () => {
    const calls: any = {};
    const findings: { file: string; line?: number; comment: string }[] = Array.from({ length: 22 }, (_, i) => ({ file: "src/a.ts", line: i + 1, comment: `c${i}` }));
    findings.push({ file: "src/a.ts", comment: "late file-level note" });
    findings.push({ file: "nope.ts", line: 1, comment: "late bogus" });
    const res = await createInlineReview(mock(calls), "o", "r", 1, "sha", "comment", findings, ranges);
    assert.equal(calls.review.comments.length, 20);
    assert.equal(res.posted, 20);
    assert.equal(res.dropped, 3); // 2 valid over cap + 1 bogus
    assert.match(calls.review.body, /late file-level note/);
  });
});
