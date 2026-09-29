// src/index.ts
import { Plugin } from "@opencode/plugin";
import { buildSuffix, parseConfig } from "./config.js";
import { pruneStale, resolveValidLevels, VariantStore } from "./variants.js";

const store = new VariantStore(500);
const LEVEL_DESC =
  "The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources.";

async function currentModel(ctx: any, sessionID: string): Promise<{ providerID?: string; id?: string }> {
  try {
    const info = await ctx.session.get({ sessionID });
    return { providerID: info?.model?.providerID, id: info?.model?.id ?? info?.model?.modelID };
  } catch {
    return {};
  }
}

export default Plugin.define({
  id: "adaptive-thinking",
  async setup(ctx: any) {
    const parsed = parseConfig(ctx.options ?? {});
    if (!parsed.ok) {
      // No toast surface in server ctx; log only (quiet suppresses even this to warn).
      console.error(`[adaptive-thinking] Invalid config: ${parsed.error}`);
      return;
    }
    const config = parsed.config;
    if (!config.enabled) return;

    const regs: Array<{ dispose: () => Promise<void> }> = [];

    regs.push(
      await ctx.tool.transform((editor: any) => {
        editor.add({
          name: config.toolName,
          description: config.toolDescription,
          input: {
            type: "object",
            properties: { level: { type: "string", description: LEVEL_DESC } },
            required: ["level"],
            additionalProperties: false,
          },
          execute: async (input: any, toolCtx: any) => {
            const sessionID: string = toolCtx?.sessionID ?? "";
            const level: string = (input as { level?: unknown })?.level as string;
            const model = await currentModel(ctx, sessionID);
            const valid = resolveValidLevels(await ctx.model.list(), model.providerID, model.id);
            if (valid.length === 0) {
              return {
                content: "Failed to set reasoning effort: no valid reasoning effort levels are available for this session",
              };
            }
            if (typeof level !== "string" || !valid.includes(level)) {
              return { content: `Invalid reasoning effort level: ${String(level)}. Valid levels: ${valid.join(", ")}.` };
            }
            store.set(sessionID, level);
            return { content: `Reasoning effort set to ${level}` };
          },
        });
      }),
    );

    regs.push(
      await ctx.session.hook("context", async (event: any) => {
        const model = event?.model as { providerID?: string; id?: string } | undefined;
        const valid = resolveValidLevels(await ctx.model.list(), model?.providerID, model?.id);
        pruneStale(store, event.sessionID, valid);
        const current = store.get(event.sessionID);
        event.system.push({
          type: "text",
          text: buildSuffix({ systemPrompt: config.systemPrompt, toolName: config.toolName, current, valid }),
        });
        if (current && valid.includes(current)) event.options.reasoningEffort = current;
      }),
    );

    return () => {
      store.clear();
      void Promise.all(regs.map((r) => r.dispose()));
    };
  },
});
