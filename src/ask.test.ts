import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseAskComment, buildAskPrompt, collectFeedbackSignals } from "./ask.js";

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
