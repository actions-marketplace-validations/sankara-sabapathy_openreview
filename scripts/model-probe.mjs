#!/usr/bin/env node
/**
 * Is this model a reasoning (thinking) model?
 *
 * Run:  node scripts/model-probe.mjs [model ...]
 * Key:  OPENCODE_API_KEY — and only that. This script deliberately does NOT
 *       reach into other tools' credential stores (e.g. OpenCode's
 *       ~/.local/share/opencode/opencode.db). Quietly reading a credential
 *       you never handed over — even just to spend a little of your own quota
 *       on your behalf — is not the script's call to make. If you want the
 *       probe to use your OpenCode key, pass it yourself:
 *         OPENCODE_API_KEY=$(...) npm run probe:model
 *
 * Why you need this: a reasoning model bills its thinking into
 * `completion_tokens` and may answer with an EMPTY `content` field. That is
 * silent on a usage dashboard, slow (minutes per call), and it breaks naive
 * response parsing. We hit exactly that with deepseek-v4-flash.
 *
 * The tells, strongest first:
 *   1. reasoning_content / reasoning is non-empty  -> it is reasoning
 *   2. completion_tokens >> visible characters      -> thinking tokens billed
 *   3. finish_reason === "length" with empty content -> thinking ate the budget
 */


const BASE = process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/go/v1";

function key() {
  return process.env.OPENCODE_API_KEY?.trim() || "";
}

async function probe(model, apiKey) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 60_000);
  const t0 = Date.now();
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
        // Go requires a stable session header for routing/caching.
        "x-opencode-session": `probe-${model}-${Date.now()}`,
        "user-agent": "openreview-model-probe/1.0",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "Reply with only the word READY." },
          { role: "user", content: "Are you ready?" },
        ],
        max_tokens: 512,
      }),
    });
    const text = await res.text();
    if (!res.ok) return { model, error: `HTTP ${res.status}: ${text.slice(0, 120)}` };
    const j = JSON.parse(text);
    const msg = j.choices?.[0]?.message ?? {};
    const reasoning = msg.reasoning_content ?? msg.reasoning ?? "";
    const content = msg.content ?? "";
    const usage = j.usage ?? {};
    const seconds = (Date.now() - t0) / 1000;
    const completion = usage.completion_tokens ?? 0;
    // ~4 chars/token is a good enough estimate to spot a 100x gap.
    const visibleTokens = Math.ceil((content.trim().length || 0) / 4);
    const billed = completion > 0 && completion > visibleTokens * 4 + 32;
    return {
      model,
      reasoning: reasoning.length,
      content: content.trim().length,
      completion_tokens: completion,
      prompt_tokens: usage.prompt_tokens ?? 0,
      finish_reason: j.choices?.[0]?.finish_reason ?? "?",
      seconds: seconds.toFixed(1),
      verdict: reasoning.length > 0 ? "REASONING" : billed ? "REASONING (billed)" : "plain",
    };
  } catch (e) {
    return { model, error: e.name === "AbortError" ? "timeout (60s)" : e.message };
  } finally {
    clearTimeout(timer);
  }
}

const apiKey = key();
if (!apiKey) {
  console.error("No API key set. Export it yourself to run the probe:\n\n  OPENCODE_API_KEY=sk-... npm run probe:model\n\nThis script will not read any other tool's credential store.");
  process.exit(1);
}

const defaults = ["longcat-2.5-preview-free", "space-bunny-free", "deepseek-v4-flash"];
const models = process.argv.slice(2).length ? process.argv.slice(2) : defaults;
console.log(`Probing ${models.length} model(s) via ${BASE}\n`);
for (const m of models) console.log(JSON.stringify(await probe(m, apiKey)));