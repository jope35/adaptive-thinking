// src/config.ts
import { z } from "zod";

export const DEFAULT_SYSTEM_PROMPT =
  "You MUST manage reasoning effort actively. Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. Reassess at turn start, after meaningful new evidence, and when the task shifts. NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.";

const ConfigSchema = z.object({
  enabled: z.boolean().default(true),
  quiet: z.boolean().default(false),
  toolName: z.string().min(1).default("set_reasoning_effort"),
  toolDescription: z.string().min(1).default("Set your reasoning effort"),
  systemPrompt: z.string().min(1).default(DEFAULT_SYSTEM_PROMPT),
});

export type Config = z.infer<typeof ConfigSchema>;

export function parseConfig(raw: unknown): { ok: true; config: Config } | { ok: false; error: string } {
  const parsed = ConfigSchema.safeParse(raw ?? {});
  if (!parsed.success) return { ok: false, error: parsed.error.message };
  return { ok: true, config: parsed.data };
}

export function buildSuffix(args: {
  systemPrompt: string;
  toolName: string;
  current?: string;
  valid: string[];
}): string {
  const parts: string[] = [args.systemPrompt.trim()];
  if (args.current) parts.push(`Current reasoning effort level: ${args.current}.`);
  if (args.valid.length > 0) {
    parts.push(
      `Valid reasoning effort levels for this session: ${args.valid.join(", ")}. To change your reasoning effort, use the \`${args.toolName}\` tool with one of the valid levels. Only call it when the task complexity justifies changing levels.`,
    );
  }
  return parts.join(" ");
}
