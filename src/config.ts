import { z } from "zod";

export const ProviderKind = z.enum([
  "anthropic",
  "openai",
  "opencode",
  "openai-compatible",
]);
export type ProviderKind = z.infer<typeof ProviderKind>;

export const ProviderConfig = z.object({
  kind: ProviderKind.default("openai"),
  model: z.string(),
  base_url: z.string().optional(),
  key_from: z.string().optional(), // e.g. "secrets.ANTHROPIC_API_KEY" (docs only; action reads inputs/env)
});
export type ProviderConfig = z.infer<typeof ProviderConfig>;

export const AgentConfig = z.object({
  name: z.string().optional(),
  provider: z.string(),
  instructions: z.string(),
  max_files: z.number().int().positive().optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

export const VerdictConfig = z.object({
  mode: z.enum(["comment", "approve", "request_changes"]).default("comment"),
  min_severity: z.enum(["suggestion", "medium", "high"]).default("medium"),
  post_inline: z.boolean().default(true),
  deduplicate: z.boolean().default(true),
});
export type VerdictConfig = z.infer<typeof VerdictConfig>;

export const ReviewConfig = z.object({
  id: z.string(),
  if_paths: z.array(z.string()).default(["**"]),
  providers: z.array(z.string()).optional(), // informative; agents pick providers
  strategy: z.enum(["any", "all", "majority"]).default("any"),
  main: AgentConfig,
  subagents: z.array(AgentConfig).default([]),
  verdict: VerdictConfig.default({}),
});
export type ReviewConfig = z.infer<typeof ReviewConfig>;

export const OpenReviewConfig = z.object({
  version: z.literal(1),
  defaults: z
    .object({
      on: z.array(z.string()).default(["opened", "synchronize", "ready_for_review"]),
      command: z.string().default("/review"),
      draft: z.boolean().default(false),
      lang: z.string().default("en"),
      ignore: z.array(z.string()).default([]),
      max_diff_chars: z.number().int().positive().default(80000),
    })
    .default({}),
  providers: z.record(z.string(), ProviderConfig),
  reviews: z.array(ReviewConfig).min(1),
  global_verdict: z
    .object({
      strategy: z.enum(["any_blocking", "max_severity", "majority"]).default("any_blocking"),
      sticky_comment: z.boolean().default(true),
      fail_check_on_request_changes: z.boolean().default(false),
    })
    .default({}),
});
export type OpenReviewConfig = z.infer<typeof OpenReviewConfig>;

export function parseConfig(raw: unknown): OpenReviewConfig {
  return OpenReviewConfig.parse(raw);
}
