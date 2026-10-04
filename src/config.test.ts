import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  OpenReviewConfig,
  ProviderConfig,
  ReviewConfig,
  VerdictConfig,
  AgentConfig,
  AuthConfig,
} from "./config.js";

// Mechanical guard for issue #57: every fixed config key must be read by the
// engine. Rule: a property access `.key`, `["key"]`, `['key']` or a
// destructured `{ key` somewhere in src/ outside config.ts and tests.
// Comments are stripped first, so a key mentioned only in prose fails.
// Dynamic maps (provider names, models entries) have user-defined keys and
// are not schema keys — only the map field itself (`providers`, `models`) is
// checked. Runs in-repo only (needs ../../src next to dist-src).
function fixedKeys(schema: any, out = new Set<string>(), seen = new Set<any>()): Set<string> {
  if (!schema || seen.has(schema)) return out;
  seen.add(schema);
  const t = schema._def?.typeName;
  if (t === "ZodObject") {
    for (const [k, v] of Object.entries<any>(schema.shape)) {
      out.add(k);
      fixedKeys(v, out, seen);
    }
  } else if (t === "ZodDefault" || t === "ZodOptional") {
    fixedKeys(schema._def.innerType, out, seen);
  } else if (t === "ZodArray") {
    fixedKeys(schema._def.type, out, seen);
  }
  return out;
}

describe("config surface (issue #57)", () => {
  it("every schema field is read outside config.ts", () => {
    const here = dirname(fileURLToPath(import.meta.url));
    const src = join(here, "../../src");
    if (!existsSync(src)) return; // tests running outside a checkout
    const code = readdirSync(src)
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "config.ts")
      .map((f) =>
        readFileSync(join(src, f), "utf8")
          .replace(/\/\*[\s\S]*?\*\//g, "")
          .replace(/(^|\s)\/\/.*$/gm, "$1")
      )
      .join("\n");
    const keys = fixedKeys(OpenReviewConfig);
    for (const s of [ProviderConfig, ReviewConfig, VerdictConfig, AgentConfig, AuthConfig])
      fixedKeys(s, keys);
    const dead = [...keys].filter((k) => {
      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Property access in any common shape: `.key`, `["key"]`, `['key']`,
      // `{ key`, `{key` — with a word boundary after, so `timeout_s` never
      // matches inside `timeout_something`.
      return !new RegExp(`[.["'\\s{]${esc}(?![\\w$])`).test(code);
    });
    assert.deepEqual(
      dead,
      [],
      `dead config fields (parsed, documented, never read): ${dead.join(", ")} — implement or delete per #57`
    );
  });
});
