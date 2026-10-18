import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAskComment, buildAskPrompt, collectFeedbackSignals, isAskAllowed, resolveAskProvider } from "./ask.js";
import { parseConfig } from "./config.js";
describe("parseAskComment (issue #23)", () => {
  it("parses a plain question", () => {
    assert.deepEqual(parseAskComment("/ask why is this flagged?"), {
      question: "why is this flagged?",
      quoted: "",
    });
  });
  it("is case-insensitive and trims", () => {
    assert.deepEqual(parseAskComment("  /ASK   what about retries?  "), {
      question: "what about retries?",
      quoted: "",
    });
  });
  it("splits >-quoted context from the question", () => {
    const out = parseAskComment("/ask is this right?\n> file.ts:10 null deref\n> second quoted line\nmore detail here");
    assert.ok(out);
    assert.equal(out.question, "is this right?\nmore detail here");
    assert.equal(out.quoted, "file.ts:10 null deref\nsecond quoted line");
  });
  it("rejects non-ask bodies and bare /ask", () => {
    assert.equal(parseAskComment("/review"), null);
    assert.equal(parseAskComment("please /ask this"), null);
    assert.equal(parseAskComment("/ask"), null);
    assert.equal(parseAskComment("/ask   "), null);
    assert.equal(parseAskComment(undefined), null);
  });
});

describe("buildAskPrompt (issue #23)", () => {
  const p = buildAskPrompt({
    diff: "DIFF",
    priorFindings: [{ file: "a.ts", line: 3, comment: "Old bug." }],
    quoted: "quoted finding",
    question: "Why?",
  });
  it("grounds the question in diff, priors, and quoted context", () => {
    assert.match(p.user, /DIFF/);
    assert.match(p.user, /a\.ts:3/);
    assert.match(p.user, /Old bug\./);
    assert.match(p.user, /quoted finding/);
    assert.match(p.user, /Why\?/);
  });
  it("asks for markdown, not a JSON object", () => {
    assert.match(p.system, /markdown/);
    assert.doesNotMatch(p.system, /\{/);
    assert.doesNotMatch(p.user, /json_object|response_format/i);
  });
});

describe("collectFeedbackSignals (issue #23)", () => {
  const comment = (id: number, body: string) => ({ id, user: { type: "Bot" }, body, html_url: `u${id}` });
  const mock = (comments: any[], reactions: Record<number, any[]>) => ({
    paginate: async () => comments,
    rest: {
      issues: { listComments: () => {} },
      reactions: {
        listForIssueComment: async (p: any) => ({ data: reactions[p.comment_id] ?? [] }),
      },
    },
  });

  it("aggregates bot-comment reactions, ignoring others", async () => {
    const out = await collectFeedbackSignals(
      mock(
        [
          comment(1, "<!-- openreview:sticky -->\nreview"),
          comment(2, "human chatter"),
          comment(3, "<!-- openreview:answer -->\nanswer"),
        ],
        { 1: [{ content: "+1" }, { content: "+1" }, { content: "-1" }], 3: [{ content: "heart" }] }
      ) as any,
      "o",
      "r",
      7
    );
    assert.deepEqual(out.totals, { "+1": 2, "-1": 1, heart: 1 });
    assert.equal(out.comments.length, 2);
  });

  it("never throws; API failure yields empty signal", async () => {
    const broken = {
      paginate: async () => {
        throw new Error("boom");
      },
      rest: { issues: { listComments: () => {} }, reactions: { listForIssueComment: async () => ({ data: [] }) } },
    } as any;
    assert.deepEqual(await collectFeedbackSignals(broken, "o", "r", 7), { comments: [], totals: {} });
  });
});

describe("isAskAllowed (issue #59, reused for #23)", () => {
  it("allows the default write roles and honors overrides", () => {
    assert.equal(isAskAllowed("OWNER", undefined), true);
    assert.equal(isAskAllowed("member", undefined), true);
    assert.equal(isAskAllowed("COLLABORATOR", undefined), true);
    assert.equal(isAskAllowed("NONE", undefined), false);
    assert.equal(isAskAllowed(undefined, undefined), false);
    assert.equal(isAskAllowed("CONTRIBUTOR", "CONTRIBUTOR"), true);
    assert.equal(isAskAllowed("OWNER", "MEMBER"), false);
  });
});

describe("resolveAskProvider (issue #23)", () => {
  const cfg = (providers: any, mainProvider: string) =>
    parseConfig({ version: 1, providers, reviews: [{ id: "r", main: { provider: mainProvider, instructions: "i" } }] });
  it("resolves plain and dotted providers", () => {
    const ok = resolveAskProvider(cfg({ go: { model: "m" } }, "go"));
    assert.equal(ok.ok, true);
    if (ok.ok) assert.equal(ok.provider.model, "m");
    const dotted = resolveAskProvider(
      cfg({ go: { model: "base", models: { flash: { model: "f" } } } }, "go.flash")
    );
    assert.equal(dotted.ok, true);
    if (dotted.ok) assert.equal(dotted.provider.model, "f");
  });
  it("reports missing reviews and unknown providers instead of throwing", () => {
    assert.deepEqual(resolveAskProvider({ reviews: [], providers: {} }), {
      ok: false,
      reason: "no reviews configured",
    });
    const bad = resolveAskProvider(cfg({ go: { model: "m" } }, "nope"));
    assert.equal(bad.ok, false);
  });
});
