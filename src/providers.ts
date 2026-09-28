import type { ProviderConfig } from "./config.js";

export type ResolvedKeys = {
  anthropicApiKey: string;
  openaiApiKey: string;
  opencodeApiKey: string;
  opencodeBaseUrl: string;
  githubToken: string;
};

export function resolveKeysFromEnv(env: NodeJS.ProcessEnv): ResolvedKeys {
  return {
    anthropicApiKey:
      env["INPUT_ANTHROPIC-API-KEY"] || env["ANTHROPIC_API_KEY"] || "",
    openaiApiKey: env["INPUT_OPENAI-API-KEY"] || env["OPENAI_API_KEY"] || "",
    opencodeApiKey:
      env["INPUT_OPENCODE-API-KEY"] || env["OPENCODE_API_KEY"] || "",
    opencodeBaseUrl:
      env["INPUT_OPENCODE-BASE-URL"] ||
      env["OPENCODE_BASE_URL"] ||
      "https://opencode.ai/zen/v1",
    githubToken:
      env["INPUT_GITHUB-TOKEN"] || env["GITHUB_TOKEN"] || env["GH_TOKEN"] || "",
  };
}

export type Finding = {
  file: string;
  line?: number;
  severity: "high" | "medium" | "suggestion";
  category: string;
  comment: string;
  confidence: number; // 0-1
  agent: string;
  provider: string;
};

const SYSTEM_WRAPPER = (lang: string, instructions: string) =>
  `You are a senior code reviewer. Language: ${lang}.\nCustom instructions: ${instructions}\n\nReturn ONLY valid JSON: {"findings":[{"file":string,"line":number|null,"severity":"high|medium|suggestion","category":string,"comment":string,"confidence":0-1}]}. No markdown fences. Be strict on bugs/security, lenient on style. Skip low-confidence nits.`;

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "\n...[truncated]" : s;
}

async function callAnthropic(opts: {
  apiKey: string;
  model: string;
  system: string;
  user: string;
}): Promise<string> {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 2000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as any;
  const text = (j.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("\n");
  return text;
}

async function callOpenAICompatible(opts: {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  user: string;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${opts.apiKey}`,
    },
    body: JSON.stringify({
      model: opts.model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
      ],
      temperature: 0.2,
      max_tokens: 2000,
      response_format: { type: "json_object" },
    }),
  });
  if (!res.ok) throw new Error(`llm ${base} ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as any;
  return j.choices?.[0]?.message?.content ?? '{"findings":[]}';
}

export function pickKey(
  providerName: string,
  provider: ProviderConfig,
  keys: ResolvedKeys
): { apiKey: string; baseUrl: string } {
  const kind = provider.kind;
  if (kind === "anthropic")
    return { apiKey: keys.anthropicApiKey, baseUrl: "https://api.anthropic.com" };
  if (kind === "openai")
    return { apiKey: keys.openaiApiKey, baseUrl: "https://api.openai.com/v1" };
  // opencode + openai-compatible share the OpenAI-compatible path
  return {
    apiKey: keys.opencodeApiKey || keys.openaiApiKey,
    baseUrl: provider.base_url || keys.opencodeBaseUrl,
  };
}

export async function runAgent(opts: {
  agentName: string;
  providerName: string;
  provider: ProviderConfig;
  instructions: string;
  diff: string;
  lang: string;
  keys: ResolvedKeys;
  maxDiffChars: number;
}): Promise<Finding[]> {
  const system = SYSTEM_WRAPPER(opts.lang, opts.instructions);
  const user = `Review this unified diff (truncated):\n\n${truncate(opts.diff, opts.maxDiffChars)}`;
  const { apiKey, baseUrl } = pickKey(opts.providerName, opts.provider, opts.keys);
  if (!apiKey) return []; // missing BYOK key -> skip silently, caller warns

  let raw: string;
  if (opts.provider.kind === "anthropic") {
    raw = await callAnthropic({ apiKey, model: opts.provider.model, system, user });
  } else {
    raw = await callOpenAICompatible({
      apiKey,
      baseUrl,
      model: opts.provider.model,
      system,
      user,
    });
  }
  try {
    const cleaned = raw.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
    const parsed = JSON.parse(cleaned) as { findings?: any[] };
    const out: Finding[] = [];
    for (const f of parsed.findings ?? []) {
      if (!f?.file || !f?.comment) continue;
      const sev =
        f.severity === "high" || f.severity === "medium" ? f.severity : "suggestion";
      out.push({
        file: String(f.file),
        line: typeof f.line === "number" ? f.line : undefined,
        severity: sev,
        category: String(f.category ?? "general"),
        comment: String(f.comment).slice(0, 1200),
        confidence: typeof f.confidence === "number" ? f.confidence : 0.7,
        agent: opts.agentName,
        provider: opts.providerName,
      });
    }
    return out;
  } catch {
    return [];
  }
}
