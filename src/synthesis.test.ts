import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  labelFindings,
  renderPriorFindings,
  parseSynthesis,
  mergeSynthesis,
  type Synthesis,
} from "./synthesis.js";
import { runAgent, extractReviewJson, extractFindingsJson, type Finding } from "./providers.js";
import { runReviewAgents } from "./main.js";
import { renderSynthesis, renderStickyBody, renderAppendSection } from "./github.js";
import { parseConfig } from "./config.js";

const f = (over: Partial<Finding> = {}): Finding => ({
  file: "a.ts",
  line: 1,
  severity: "medium",
  category: "bug",
  comment: "c",
  confidence: 0.8,
  agent: "sub",
  provider: "p1",
  model: "m1",
  ...over,
});

const synth = (over: Partial<Synthesis> = {}): Synthesis => ({
  summary: "",
  walkthrough: [],
  dismissed: [],
  sources: [],
  ...over,
});

describe("main_mode config", () => {
  it("defaults to synthesize and accepts parallel", () => {
    const base = { version: 1, providers: { p: { model: "m" } } };
    const a = parseConfig({ ...base, reviews: [{ id: "r", main: { provider: "p", instructions: "i" } }] });
    assert.equal(a.reviews[0].main_mode, "synthesize");
    const b = parseConfig({
      ...base,
      reviews: [{ id: "r", main_mode: "parallel", main: { provider: "p", instructions: "i" } }],
    });
    assert.equal(b.reviews[0].main_mode, "parallel");
    assert.throws(() =>
      parseConfig({ ...base, reviews: [{ id: "r", main_mode: "first", main: { provider: "p", instructions: "i" } }] })
    );
  });
});

describe("renderPriorFindings", () => {
  it("labels findings F1..Fn and renders one JSON line each", () => {
    const out = renderPriorFindings(labelFindings([f({ comment: "x" }), f({ comment: "y", line: undefined })]));
    const lines = out.split("\n").filter((l) => l.startsWith("{"));
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).id, "F1");
    assert.equal(JSON.parse(lines[1]).id, "F2");
    assert.equal(JSON.parse(lines[1]).line, null);
  });

  it("says so plainly when there is nothing to synthesize", () => {
    assert.match(renderPriorFindings([]), /None\./);
  });

  it("stops at the budget and notes what it left out", () => {
    const many = labelFindings(Array.from({ length: 50 }, (_, i) => f({ comment: `finding ${i} `.repeat(10) })));
    const out = renderPriorFindings(many, 2000);
    assert.ok(out.length < 2400, `rendered ${out.length} chars for a 2000 budget`);
    assert.match(out, /more finding\(s\) omitted for length; they are kept as reported/);
  });
});

describe("parseSynthesis", () => {
  it("keeps sources aligned with the findings the caller kept", () => {
    const raw = [
      { file: "a.ts", comment: "ok", sources: ["F1"] },
      { file: "", comment: "dropped by caller", sources: ["F2"] },
      { file: "b.ts", comment: "ok2", sources: "F3" },
    ];
    const s = parseSynthesis({ summary: "  two\n lines ", walkthrough: [{ file: "a.ts", change: "x" }, { file: "b.ts" }] }, raw, [true, false, true]);
    assert.deepEqual(s.sources, [["F1"], []]);
    assert.equal(s.summary, "two lines");
    assert.deepEqual(s.walkthrough, [{ file: "a.ts", change: "x" }]);
    assert.deepEqual(s.dismissed, []);
  });

  it("gives a dismissal without a reason a visible placeholder", () => {
    const s = parseSynthesis({ dismissed: [{ id: "F1" }, { reason: "no id" }] }, [], []);
    assert.deepEqual(s.dismissed, [{ id: "F1", reason: "no reason given" }]);
  });
});

describe("mergeSynthesis", () => {
  const prior = labelFindings([
    f({ agent: "sec", provider: "p1", model: "m1", comment: "sql injection" }),
    f({ agent: "corr", provider: "p2", model: "m2", comment: "sql injection again" }),
    f({ agent: "corr", provider: "p2", model: "m2", comment: "false alarm" }),
    f({ agent: "style", provider: "p3", model: "m3", comment: "never mentioned" }),
  ]);
  const main = (over: Partial<Finding> = {}) => f({ agent: "r:main", provider: "pm", model: "mm", ...over });

  it("merges duplicates, dismisses with reasons, keeps the unmentioned", () => {
    const out = mergeSynthesis(
      prior,
      [main({ comment: "SQL injection in query()", severity: "high" }), main({ comment: "missed race" })],
      synth({ sources: [["F1", "F2"], []], dismissed: [{ id: "F3", reason: "guarded on line 4" }] })
    );
    assert.equal(out.findings.length, 3);
    const [mergedF, own, kept] = out.findings;
    assert.equal(mergedF.comment, "SQL injection in query()");
    assert.equal(mergedF.agent, "sec+corr");
    assert.equal(mergedF.provider, "p1");
    assert.deepEqual(mergedF.voters, ["p1", "p2"]);
    assert.equal(own.agent, "r:main");
    assert.equal(own.voters, undefined);
    assert.equal(kept.comment, "never mentioned");
    assert.deepEqual(out.dismissed.map((d) => [d.finding.comment, d.reason]), [["false alarm", "guarded on line 4"]]);
  });

  it("a cited id is never also dismissed", () => {
    const out = mergeSynthesis(
      prior,
      [main({ comment: "keep" })],
      synth({ sources: [["F3"]], dismissed: [{ id: "F3", reason: "contradiction" }] })
    );
    assert.equal(out.dismissed.length, 0);
    assert.ok(out.findings.some((x) => x.comment === "keep" && x.agent === "corr"));
  });

  it("ignores invented ids instead of trusting them", () => {
    const out = mergeSynthesis(
      prior,
      [main({ comment: "mine" })],
      synth({ sources: [["F99"]], dismissed: [{ id: "F42", reason: "?" }] })
    );
    // F99 is unknown: the finding is the main agent's own. F42 dismisses nothing.
    assert.equal(out.findings[0].agent, "r:main");
    assert.equal(out.findings.length, 1 + prior.length);
    assert.equal(out.dismissed.length, 0);
  });

  it("an empty synthesis keeps every prior finding", () => {
    const out = mergeSynthesis(prior, [], synth());
    assert.deepEqual(out.findings, prior.map((p) => p.finding));
  });

  it("inherits validation status through the merge (issue #18)", () => {
    const labeled = labelFindings([
      f({ comment: "fixed bug", status: "fixed" }),
      f({ comment: "fixed bug again", status: "fixed" }),
      f({ comment: "open bug", status: "open" }),
      f({ comment: "fresh bug", status: "new" }),
    ]);
    const out = mergeSynthesis(
      labeled,
      [main({ comment: "merged fix" }), main({ comment: "merged open" }), main({ comment: "own addition" })],
      synth({ sources: [["F1", "F2"], ["F3", "F4"], []] })
    );
    const byComment = new Map(out.findings.map((x) => [x.comment, x]));
    assert.equal(byComment.get("merged fix")?.status, "fixed");
    assert.equal(byComment.get("merged open")?.status, "new");
    assert.equal(byComment.get("own addition")?.status, "new");
  });

  it("an explicit synthesizer status wins over inheritance", () => {
    const labeled = labelFindings([f({ comment: "bug", status: "open" })]);
    const out = mergeSynthesis(labeled, [main({ comment: "done", status: "fixed" })], synth({ sources: [["F1"]] }));
    assert.equal(out.findings[0].status, "fixed");
  });

  it("carries suggestions through the merge (issue #22)", () => {
    const labeled = labelFindings([f({ comment: "bug", status: "open", suggestion: "fix();" })]);
    const out = mergeSynthesis(labeled, [main({ comment: "merged bug" })], synth({ sources: [["F1"]] }));
    assert.equal(out.findings[0].suggestion, "fix();");
  });
});

describe("runReviewAgents", () => {
  type R = { findings: Finding[]; synthesis?: Synthesis; name: string };
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

  it("synthesize: main starts only after every subagent finished, and sees their findings", async () => {
    const log: string[] = [];
    let seen = "";
    const sub = (name: string, ms: number, fs: Finding[]) => async (): Promise<R> => {
      log.push(`${name}:start`);
      await delay(ms);
      log.push(`${name}:end`);
      return { name, findings: fs };
    };
    const out = await runReviewAgents<R>({
      main: async (prior) => {
        log.push("main:start");
        seen = prior ?? "";
        return {
          name: "main",
          findings: [f({ agent: "main", comment: "merged" })],
          synthesis: synth({ summary: "S", sources: [["F1", "F2"]] }),
        };
      },
      subs: [sub("a", 20, [f({ agent: "a", comment: "one" })]), sub("b", 5, [f({ agent: "b", comment: "two" })])],
      synthesize: true,
      maxConcurrency: 4,
    });
    assert.equal(log.indexOf("main:start"), log.length - 1);
    assert.ok(log.includes("a:end") && log.includes("b:end"));
    assert.match(seen, /"id":"F1".*"one"/);
    assert.match(seen, /"id":"F2".*"two"/);
    assert.deepEqual(out.results.map((r) => r.name), ["main", "a", "b"]);
    assert.deepEqual(out.findings.map((x) => [x.comment, x.agent]), [["merged", "a+b"]]);
    assert.equal(out.synthesis?.summary, "S");
    assert.equal(out.reported, 2);
  });

  it("synthesize: a main with no usable synthesis falls back to the subagent union", async () => {
    const out = await runReviewAgents<R>({
      main: async () => ({ name: "main", findings: [] }),
      subs: [async () => ({ name: "a", findings: [f({ comment: "one" })] })],
      synthesize: true,
      maxConcurrency: 2,
    });
    assert.deepEqual(out.findings.map((x) => x.comment), ["one"]);
    assert.equal(out.synthesis, undefined);
    assert.equal(out.results.length, 2);
  });

  it("parallel: main gets no prior findings and runs alongside the subagents", async () => {
    let prior: string | undefined = "unset";
    let inFlight = 0;
    let peak = 0;
    const task = (name: string) => async (): Promise<R> => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await delay(10);
      inFlight--;
      return { name, findings: [f({ comment: name })] };
    };
    const out = await runReviewAgents<R>({
      main: async (p) => {
        prior = p;
        return task("main")();
      },
      subs: [task("a"), task("b")],
      synthesize: false,
      maxConcurrency: 4,
    });
    assert.equal(prior, undefined);
    assert.equal(peak, 3);
    assert.deepEqual(out.findings.map((x) => x.comment), ["main", "a", "b"]);
  });

  it("no runnable main: subagents still run and are unioned", async () => {
    const out = await runReviewAgents<R>({
      main: null,
      subs: [async () => ({ name: "a", findings: [f()] })],
      synthesize: true,
      maxConcurrency: 1,
    });
    assert.equal(out.findings.length, 1);
  });
});

describe("runAgent as synthesizer", () => {
  const cfg = parseConfig({
    version: 1,
    providers: { oai: { model: "m", kind: "openai", base_url: "http://127.0.0.1:1/v1", retries: 0 } },
    reviews: [{ id: "r", main: { provider: "oai", instructions: "i" } }],
  });
  const keys = { anthropicApiKey: "", openaiApiKey: "k", opencodeApiKey: "", opencodeBaseUrl: "", githubToken: "" };
  const withFetch = async (impl: (url: any, init: any) => Promise<Response>, fn: () => Promise<any>) => {
    const real = globalThis.fetch;
    globalThis.fetch = impl as any;
    try {
      return await fn();
    } finally {
      globalThis.fetch = real;
    }
  };
  const base = {
    agentName: "r:main",
    providerName: "oai",
    provider: cfg.providers.oai,
    instructions: "i",
    diff: "d",
    lang: "en",
    keys,
    maxDiffChars: 100,
    sessionId: "s",
  };

  it("sends the prior findings with the synthesis contract and parses summary + walkthrough", async () => {
    let body: any;
    const reply = {
      summary: "Adds a cache.",
      walkthrough: [{ file: "a.ts", change: "new cache" }],
      findings: [{ file: "a.ts", line: 3, severity: "high", category: "bug", comment: "stale read", confidence: 0.9, sources: ["F1"] }],
      dismissed: [{ id: "F2", reason: "handled" }],
    };
    const r = await withFetch(
      async (_u, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(reply) } }] }));
      },
      () => runAgent({ ...base, priorFindings: "<prior_findings>\nPRIOR-MARKER\n</prior_findings>" })
    );
    const system = body.messages.find((m: any) => m.role === "system").content;
    const user = body.messages.find((m: any) => m.role === "user").content;
    assert.match(system, /synthesizing a multi-agent review/);
    assert.match(user, /PRIOR-MARKER/);
    assert.match(user, /"walkthrough"/);
    assert.equal(r.findings.length, 1);
    assert.equal(r.synthesis.summary, "Adds a cache.");
    assert.deepEqual(r.synthesis.walkthrough, [{ file: "a.ts", change: "new cache" }]);
    assert.deepEqual(r.synthesis.sources, [["F1"]]);
    assert.deepEqual(r.synthesis.dismissed, [{ id: "F2", reason: "handled" }]);
  });

  it("gives the synthesizer a larger output budget, still overridable by extra_body", async () => {
    const seen: number[] = [];
    const fetchOk = async (_u: any, init: any) => {
      seen.push(JSON.parse(init.body).max_tokens);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }));
    };
    await withFetch(fetchOk, () => runAgent(base));
    await withFetch(fetchOk, () => runAgent({ ...base, priorFindings: "x" }));
    await withFetch(fetchOk, () =>
      runAgent({ ...base, priorFindings: "x", provider: { ...base.provider, extra_body: { max_tokens: 8000 } } })
    );
    assert.deepEqual(seen, [2000, 4000, 8000]);
  });

  it("a plain review carries no synthesis and keeps the findings-only prompt", async () => {
    let body: any;
    const r = await withFetch(
      async (_u, init) => {
        body = JSON.parse(init.body);
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"findings":[]}' } }] }));
      },
      () => runAgent(base)
    );
    assert.equal(r.synthesis, undefined);
    assert.doesNotMatch(body.messages.find((m: any) => m.role === "user").content, /prior_findings|walkthrough/);
  });
});

describe("extractReviewJson", () => {
  it("keeps sibling keys of the findings object, even when nested in prose", () => {
    const raw = 'thinking {not json} then {"summary":"s","findings":[{"file":"a"}],"dismissed":[]}';
    const holder = extractReviewJson(raw);
    assert.equal(holder?.summary, "s");
    // extractFindingsJson keeps its historical findings-only shape.
    assert.deepEqual(extractFindingsJson(raw), { findings: [{ file: "a" }] });
  });
});

describe("sticky synthesis rendering", () => {
  const row = {
    id: "general",
    verdict: "comment",
    count: 1,
    counted: true,
    synthesis: { summary: "Adds a | cache.", walkthrough: [{ file: "a.ts", change: "new | cache" }] },
    dismissed: [{ file: "b.ts", line: 2, severity: "medium", agent: "corr", reason: "handled | upstream" }],
  };

  it("renders summary, walkthrough and dismissed findings with cells escaped", () => {
    const out = renderSynthesis([row]).join("\n");
    assert.match(out, /\*\*Summary\*\*/);
    assert.match(out, /Adds a \| cache\./);
    assert.match(out, /Walkthrough \(1 file\)/);
    assert.match(out, /\| `a\.ts` \| new \\\| cache \|/);
    assert.match(out, /1 finding\(s\) dismissed by the synthesizer/);
    assert.match(out, /\| medium \| `b\.ts:2` \| corr \| handled \\\| upstream \|/);
  });

  it("names the review only when several are shown, and renders nothing without data", () => {
    assert.doesNotMatch(renderSynthesis([row]).join("\n"), /`general`/);
    const two = renderSynthesis([row, { id: "sec", verdict: "approve", count: 0 }]).join("\n");
    assert.match(two, /Summary — `general`/);
    assert.deepEqual(renderSynthesis([{ id: "sec", verdict: "approve", count: 0 }]), []);
  });

  it("caps the total size across many reviews", () => {
    const big = (id: string) => ({
      ...row,
      id,
      synthesis: {
        summary: "s".repeat(1200),
        walkthrough: Array.from({ length: 25 }, (_, i) => ({ file: `f${i}.ts`, change: "c".repeat(240) })),
      },
    });
    const out = renderSynthesis(Array.from({ length: 10 }, (_, i) => big(`r${i}`))).join("\n");
    assert.ok(out.length < 25000, `synthesis block is ${out.length} chars`);
    assert.match(out, /more review\(s\) omitted for length/);
  });

  it("appears in both the update body and append sections", () => {
    const opts = { verdict: "comment", status: "ok" as const, perReview: [row], findings: [] };
    assert.match(renderStickyBody(opts), /\*\*Summary\*\*/);
    assert.match(renderAppendSection({ ...opts, headSha: "abcdef1234" }), /Walkthrough/);
  });
});
