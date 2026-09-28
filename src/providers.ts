import type { ProviderConfig, ProviderProtocol } from "./config.js";

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
      "https://opencode.ai/zen/go/v1",
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
  baseUrl: string;
  endpointPath: string;
  headers: Record<string, string>;
  model: string;
  system: string;
  user: string;
  extraBody: Record<string, unknown>;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const res = await fetch(`${base}${opts.endpointPath}`, {
    method: "POST",
    headers: opts.headers,
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 2000,
      system: opts.system,
      messages: [{ role: "user", content: opts.user }],
      ...opts.extraBody,
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
  endpointPath: string;
  headers: Record<string, string>;
  model: string;
  system: string;
  user: string;
  jsonMode: boolean;
  extraBody: Record<string, unknown>;
}): Promise<string> {
  const base = opts.baseUrl.replace(/\/$/, "");
  const body: Record<string, unknown> = {
    model: opts.model,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    temperature: 0.2,
    max_tokens: 2000,
    ...opts.extraBody,
  };
  if (opts.jsonMode) body.response_format = { type: "json_object" };
  const res = await fetch(`${base}${opts.endpointPath}`, {
    method: "POST",
    headers: opts.headers,
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`llm ${base} ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as any;
  return j.choices?.[0]?.message?.content ?? '{"findings":[]}';
}

function kindDefaults(kind: string | undefined): {
  protocol: ProviderProtocol;
  baseUrl: string;
} {
  switch (kind) {
    case "anthropic":
      return { protocol: "anthropic-messages", baseUrl: "https://api.anthropic.com" };
    case "openai":
      return { protocol: "openai-chat", baseUrl: "https://api.openai.com/v1" };
    case "opencode":
    case "openai-compatible":
      return { protocol: "openai-chat", baseUrl: "https://opencode.ai/zen/go/v1" };
    default:
      return { protocol: "openai-chat", baseUrl: "https://api.openai.com/v1" };
  }
}

function legacyKey(kind: string | undefined, keys: ResolvedKeys): string {
  if (kind === "anthropic") return keys.anthropicApiKey;
  if (kind === "openai") return keys.openaiApiKey;
  return keys.opencodeApiKey || keys.openaiApiKey;
}

export type ResolvedProvider = {
  protocol: ProviderProtocol;
  apiKey: string;
  baseUrl: string;
  endpointPath: string;
  headers: Record<string, string>;
  jsonMode: boolean;
  extraBody: Record<string, unknown>;
};

export function resolveProvider(
  provider: ProviderConfig,
  keys: ResolvedKeys,
  env: NodeJS.ProcessEnv,
  sessionId: string
): ResolvedProvider {
  const def = kindDefaults(provider.kind);
  const protocol = provider.protocol ?? def.protocol;
  const baseUrl = provider.base_url ?? def.baseUrl;
  const endpointPath =
    provider.endpoint_path ??
    (protocol === "anthropic-messages" ? "/v1/messages" : "/chat/completions");

  // key_from: "secrets.FOO" | "env.FOO" -> $FOO, else legacy fixed inputs.
  let apiKey = "";
  if (provider.key_from) {
    const name = provider.key_from.replace(/^(secrets|env)\./, "");
    apiKey = env[name] ?? "";
  }
  if (!apiKey) apiKey = legacyKey(provider.kind, keys);

  const headers: Record<string, string> = {
    "content-type": "application/json",
    // Identify as coding-agent traffic (required by OpenCode Go/Zen, harmless elsewhere).
    "user-agent": "OpenReview/1.0 (github-action)",
    "x-opencode-session": sessionId,
    ...Object.fromEntries(
      Object.entries(provider.headers).map(([k, v]) => [k.toLowerCase(), v])
    ),
  };
  const authHeader = (provider.auth.header || "Authorization").toLowerCase();
  const authCustomized =
    provider.auth.header !== "Authorization" || provider.auth.scheme !== "Bearer";
  if (protocol === "anthropic-messages" && !authCustomized) {
    // Anthropic default: x-api-key carries the raw key.
    headers["x-api-key"] = apiKey;
  } else {
    headers[authHeader] = provider.auth.scheme
      ? `${provider.auth.scheme} ${apiKey}`
      : apiKey;
  }
  if (protocol === "anthropic-messages" && !headers["anthropic-version"]) {
    headers["anthropic-version"] = "2023-06-01";
  }
  return {
    protocol,
    apiKey,
    baseUrl,
    endpointPath,
    headers,
    jsonMode: provider.json_mode,
    extraBody: provider.extra_body ?? {},
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
  sessionId: string;
}): Promise<Finding[]> {
  const system = SYSTEM_WRAPPER(opts.lang, opts.instructions);
  const user = `Review this unified diff (truncated):\n\n${truncate(opts.diff, opts.maxDiffChars)}`;
  const rp = resolveProvider(opts.provider, opts.keys, process.env as any, opts.sessionId);
  if (!rp.apiKey) return []; // missing BYOK key -> skip silently, caller warns

  let raw: string;
  if (rp.protocol === "anthropic-messages") {
    raw = await callAnthropic({
      apiKey: rp.apiKey,
      baseUrl: rp.baseUrl,
      endpointPath: rp.endpointPath,
      headers: rp.headers,
      model: opts.provider.model,
      system,
      user,
      extraBody: rp.extraBody,
    });
  } else {
    raw = await callOpenAICompatible({
      apiKey: rp.apiKey,
      baseUrl: rp.baseUrl,
      endpointPath: rp.endpointPath,
      headers: rp.headers,
      model: opts.provider.model,
      system,
      user,
      jsonMode: rp.jsonMode,
      extraBody: rp.extraBody,
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
