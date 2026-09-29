// tests/plugin.test.ts
import { describe, expect, it, vi } from "vitest";

function makeCtx(options: unknown) {
  const toolCbs: Array<(editor: any) => void> = [];
  const hookCbs: Array<(event: any) => void> = [];
  const addedTools: any[] = [];
  const ctx: any = {
    options,
    tool: {
      transform: vi.fn(async (cb: (editor: any) => void) => {
        toolCbs.push(cb);
        const editor = { add: (t: any) => addedTools.push(t) };
        cb(editor);
        return { dispose: async () => {} };
      }),
    },
    session: {
      hook: vi.fn(async (name: string, cb: (event: any) => void) => {
        hookCbs.push(cb);
        return { dispose: async () => {} };
      }),
      get: vi.fn(async () => ({ model: { providerID: "openai", id: "gpt-5" } })),
    },
    model: {
      list: vi.fn(async () => [
        { providerID: "openai", id: "gpt-5", variants: [{ id: "low" }, { id: "high" }] },
      ]),
    },
  };
  return { ctx, toolCbs, hookCbs, addedTools };
}

describe("plugin setup", () => {
  it("registers tool + hook by default", async () => {
    const { ctx } = makeCtx({});
    const mod = await import("../src/index.js");
    const plugin = (mod as any).default;
    await plugin.setup(ctx);
    expect(ctx.tool.transform).toHaveBeenCalledTimes(1);
    expect(ctx.session.hook).toHaveBeenCalledTimes(1);
  });

  it("registers nothing when disabled", async () => {
    const { ctx } = makeCtx({ enabled: false });
    const mod = await import("../src/index.js");
    await (mod as any).default.setup(ctx);
    expect(ctx.tool.transform).not.toHaveBeenCalled();
    expect(ctx.session.hook).not.toHaveBeenCalled();
  });

  it("logs and registers nothing on invalid config", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { ctx } = makeCtx({ enabled: "yes" });
      const mod = await import("../src/index.js");
      await (mod as any).default.setup(ctx);
      expect(ctx.tool.transform).not.toHaveBeenCalled();
      expect(ctx.session.hook).not.toHaveBeenCalled();
      expect(err).toHaveBeenCalledTimes(1);
    } finally {
      err.mockRestore();
    }
  });

  it("tool accepts valid level and rejects invalid", async () => {
    const { ctx, addedTools } = makeCtx({});
    const mod = await import("../src/index.js");
    await (mod as any).default.setup(ctx);
    const tool = addedTools[0];
    const ok = await tool.execute({ level: "high" }, { sessionID: "s1", progress: async () => {} });
    expect(ok.content).toBe("Reasoning effort set to high");
    const bad = await tool.execute({ level: "ultra" }, { sessionID: "s1", progress: async () => {} });
    expect(bad.content).toContain("Invalid reasoning effort level: ultra.");
  });

  it("hook injects system text and applies stored level", async () => {
    const { ctx, hookCbs, addedTools } = makeCtx({});
    const mod = await import("../src/index.js");
    await (mod as any).default.setup(ctx);
    await addedTools[0].execute({ level: "high" }, { sessionID: "s1", progress: async () => {} });
    // NOTE: real SessionContext always carries `model` (required field); the
    // mock must mirror that shape or valid levels resolve to [].
    const event: any = {
      sessionID: "s1",
      system: [],
      options: {},
      model: { providerID: "openai", id: "gpt-5" },
    };
    await hookCbs[0](event);
    expect(event.system.length).toBe(1);
    expect(event.system[0].text).toContain("Valid reasoning effort levels for this session: low, high.");
    expect(event.options.reasoningEffort).toBe("high");
  });
});
