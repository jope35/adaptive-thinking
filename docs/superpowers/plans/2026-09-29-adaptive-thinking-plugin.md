# Adaptive-Thinking V2 Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship npm-installable OpenCode v2 plugin that injects adaptive-thinking guidance into the system prompt and exposes a self-invoked tool switching the current model's valid reasoning-effort variant (sticky, simplified redo).

**Architecture:** Promise `Plugin.define({id, setup})` registers one `ctx.tool.transform` tool plus one `ctx.session.hook("context")` hook; tool validates against runtime `ctx.model.list()` variants and writes an in-memory sticky Map, hook injects guidance text and sets `event.options.reasoningEffort`.

**Tech Stack:** TypeScript (strict), Node 20+, `@opencode/plugin` (V2), `zod` (config validation), `vitest` (tests).

**Spec:** `docs/superpowers/specs/2026-09-29-opencode-adaptive-thinking-plugin-design.md`

## Global Constraints

- Target OpenCode v2 only; import from `@opencode/plugin` (never `@opencode-ai/plugin`).
- Promise API only: `Plugin.define({ id: "adaptive-thinking", async setup(ctx) {...} })`; `setup` returns cleanup fn or void (never `{}`).
- `package.json` has `"type": "module"` and `exports { ".": "./src/index.ts" }`.
- No hardcoded effort enum; valid levels come from runtime model variant data only.
- Always-sticky lifetime; no `persist` flag, no `session.idle` listener, no synthetic messages.
- Hook writes `event.options.reasoningEffort` only when a valid sticky level exists; prompt injection always occurs when enabled.
- Config keys exactly: `enabled`, `quiet`, `toolName`, `toolDescription`, `systemPrompt` (all optional with spec defaults).
- Logging via `console.error`/`console.warn` only (no toast API, no `client.app.log` — hangs per MCP validation).
- YAGNI: no heuristic scorer, no classifier, no `/reasoning` command, no RPC/TUI, no `ctx.storage` audit (in-memory Map only).

---

## MCP validation corrections applied (authoritative over spec where they differ)

1. `ctx.model.list()` takes **no** `providerID` argument; it returns all `Model.Info[]`. Filter in code by `providerID`/`id`.
2. Variants shape is `Array<{ id: string, settings?, headers?, body? }>` with per-model custom IDs — not a fixed `none/low/medium/high/xhigh` enum and not `Object.keys(model.variants)`.
3. Current session model comes from `ctx.session.get({ sessionID })` → `info.model: { providerID, id, variant? }`; tool `execute` second arg carries `sessionID`.
4. Hook scoping is a **third** arg `hook(name, cb, { providerID? })`; this plan registers without scoping (2 args).
5. `execute` returns `{ content: string }` (Promise flavor), second arg is tool-ctx with `progress()` and `sessionID`.
6. `setup` early-exit is bare `return;`, not `return {}`.

## File map

- Create `package.json` — npm identity, scripts (`test`, `build`), deps.
- Create `tsconfig.json` — strict TS, NodeNext ESM, vitest types.
- Create `src/config.ts` — `Config` type, `DEFAULTS`, `ConfigSchema`, `parseConfig()`, `buildSuffix()`.
- Create `src/variants.ts` — `VariantStore` (capped sticky Map), `resolveValidLevels()`, `pruneStale()`.
- Create `src/index.ts` — `Plugin.define` setup wiring tool + hook.
- Create `tests/config.test.ts`, `tests/variants.test.ts`, `tests/plugin.test.ts` — one per source module.
- Create/modify `README.md` — install, options, troubleshooting.

---

### Task 1: Scaffold package, TS, test runner

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Test: `tests/smoke.test.ts`

**Interfaces:**
- Consumes: none
- Produces: `npm test` (vitest run), `npm run build` (`tsc --noEmit`)

- [ ] **Step 1: Write the smoke test**

```ts
// tests/smoke.test.ts
import { describe, expect, it } from "vitest";

describe("scaffold", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 2: Write package.json + tsconfig.json**

```json
// package.json
{
  "name": "@<scope>/opencode-adaptive-thinking",
  "version": "0.1.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "test": "vitest run",
    "build": "tsc --noEmit"
  },
  "dependencies": {
    "@opencode/plugin": "latest",
    "zod": "^3.23.0"
  },
  "devDependencies": {
    "typescript": "^5.6.0",
    "vitest": "^2.1.0"
  }
}
```

```json
// tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "skipLibCheck": true,
    "types": ["node"],
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["src/**/*.ts", "tests/**/*.ts"]
}
```

- [ ] **Step 3: Install and run tests to verify green baseline**

Run: `npm install && npm test`
Expected: 1 passed (`tests/smoke.test.ts`).

- [ ] **Step 4: Run typecheck**

Run: `npm run build`
Expected: exit 0, no errors.

- [ ] **Step 5: Commit**

```bash
git add package.json tsconfig.json tests/smoke.test.ts
git commit -m "chore: scaffold plugin package with vitest"
```

---

### Task 2: Config module (schema, defaults, suffix builder)

**Files:**
- Create: `src/config.ts`
- Test: `tests/config.test.ts`

**Interfaces:**
- Consumes: `ctx.options` (unknown object) from Task 4
- Produces: `DEFAULT_SYSTEM_PROMPT: string`, `parseConfig(raw: unknown): { ok: true; config: Config } | { ok: false; error: string }`, `buildSuffix(args: { systemPrompt: string; toolName: string; current?: string; valid: string[] }): string`, `Config` type with exactly `{ enabled: boolean; quiet: boolean; toolName: string; toolDescription: string; systemPrompt: string }`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/config.test.ts
import { describe, expect, it } from "vitest";
import { buildSuffix, DEFAULT_SYSTEM_PROMPT, parseConfig } from "../src/config.js";

describe("parseConfig", () => {
  it("defaults empty input", () => {
    const r = parseConfig({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.config.enabled).toBe(true);
      expect(r.config.quiet).toBe(false);
      expect(r.config.toolName).toBe("set_reasoning_effort");
      expect(r.config.toolDescription).toBe("Set your reasoning effort");
      expect(r.config.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    }
  });

  it("rejects wrong types", () => {
    const r = parseConfig({ enabled: "yes" });
    expect(r.ok).toBe(false);
  });
});

describe("buildSuffix", () => {
  it("includes current + valid + tool name", () => {
    const s = buildSuffix({
      systemPrompt: "Be adaptive.",
      toolName: "set_reasoning_effort",
      current: "low",
      valid: ["low", "high"],
    });
    expect(s).toContain("Be adaptive.");
    expect(s).toContain("Current reasoning effort level: low.");
    expect(s).toContain("Valid reasoning effort levels for this session: low, high.");
    expect(s).toContain("`set_reasoning_effort`");
  });

  it("omits current sentence when unknown and valid sentence when empty", () => {
    const s = buildSuffix({ systemPrompt: "Be adaptive.", toolName: "set_reasoning_effort", valid: [] });
    expect(s).not.toContain("Current reasoning effort level");
    expect(s).not.toContain("Valid reasoning effort levels");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/config.test.ts`
Expected: FAIL with "Failed to resolve import ../src/config.js" or "not defined".

- [ ] **Step 3: Write minimal implementation**

```ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/config.test.ts && npm run build`
Expected: 4 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/config.ts tests/config.test.ts
git commit -m "feat: add config schema and prompt suffix builder"
```

---

### Task 3: Variant store + runtime resolution

**Files:**
- Create: `src/variants.ts`
- Test: `tests/variants.test.ts`

**Interfaces:**
- Consumes: `Config` not needed; model rows shaped `{ providerID: string; id: string; variants?: Array<{ id: string }> }`
- Produces: `VariantStore` class with `get(sessionID: string): string | undefined`, `set(sessionID: string, level: string): void`, `delete(sessionID: string): void`, `clear(): void`; `resolveValidLevels(models: ModelRow[], providerID: string | undefined, modelID: string | undefined): string[]`; `pruneStale(store: VariantStore, sessionID: string, valid: string[]): void`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/variants.test.ts
import { describe, expect, it } from "vitest";
import { pruneStale, resolveValidLevels, VariantStore } from "../src/variants.js";

const models = [
  { providerID: "openai", id: "gpt-5", variants: [{ id: "low" }, { id: "high" }] },
  { providerID: "anthropic", id: "sonnet", variants: [{ id: "low" }, { id: "max" }] },
];

describe("resolveValidLevels", () => {
  it("returns ids for the current model only", () => {
    expect(resolveValidLevels(models, "openai", "gpt-5")).toEqual(["low", "high"]);
  });

  it("returns empty when model unknown", () => {
    expect(resolveValidLevels(models, "openai", "nope")).toEqual([]);
  });

  it("returns empty when variants missing", () => {
    expect(resolveValidLevels([{ providerID: "x", id: "y" }], "x", "y")).toEqual([]);
  });
});

describe("VariantStore", () => {
  it("stores sticky levels and prunes stale on model switch", () => {
    const store = new VariantStore(2);
    store.set("s1", "high");
    expect(store.get("s1")).toBe("high");
    pruneStale(store, "s1", ["low"]);
    expect(store.get("s1")).toBeUndefined();
  });

  it("evicts oldest beyond cap", () => {
    const store = new VariantStore(2);
    store.set("a", "low");
    store.set("b", "low");
    store.set("c", "low");
    expect(store.get("a")).toBeUndefined();
    expect(store.get("c")).toBe("low");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/variants.test.ts`
Expected: FAIL with import / not-defined error.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/variants.ts
export type ModelRow = {
  providerID: string;
  id: string;
  variants?: Array<{ id: string }>;
};

export class VariantStore {
  private map = new Map<string, string>();
  constructor(private cap = 500) {}

  get(sessionID: string): string | undefined {
    return this.map.get(sessionID);
  }

  set(sessionID: string, level: string): void {
    if (this.map.has(sessionID)) this.map.delete(sessionID);
    this.map.set(sessionID, level);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(sessionID: string): void {
    this.map.delete(sessionID);
  }

  clear(): void {
    this.map.clear();
  }
}

export function resolveValidLevels(
  models: ModelRow[],
  providerID: string | undefined,
  modelID: string | undefined,
): string[] {
  if (!providerID || !modelID) return [];
  const found = models.find((m) => m.providerID === providerID && m.id === modelID);
  if (!found || !Array.isArray(found.variants)) return [];
  return found.variants.map((v) => v.id).filter((id) => typeof id === "string" && id.length > 0);
}

export function pruneStale(store: VariantStore, sessionID: string, valid: string[]): void {
  const current = store.get(sessionID);
  if (current !== undefined && !valid.includes(current)) store.delete(sessionID);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/variants.test.ts && npm run build`
Expected: 5 passed, typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/variants.ts tests/variants.test.ts
git commit -m "feat: add sticky variant store and runtime level resolution"
```

---

### Task 4: Plugin entry (tool + context hook wiring)

**Files:**
- Create: `src/index.ts`
- Test: `tests/plugin.test.ts`

**Interfaces:**
- Consumes: `parseConfig`, `buildSuffix` from `src/config.js`; `VariantStore`, `resolveValidLevels` from `src/variants.js`
- Produces: default export `Plugin.define({ id: "adaptive-thinking", setup })`; behavior: `enabled=false` registers nothing; invalid config logs via `console.error` and registers nothing; tool returns exact strings `Reasoning effort set to <level>`, `Invalid reasoning effort level: <level>. Valid levels: <csv>.`, `Failed to set reasoning effort: no valid reasoning effort levels are available for this session`

- [ ] **Step 1: Write the failing tests (mocked ctx)**

```ts
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
    const event: any = { sessionID: "s1", system: [], options: {} };
    await hookCbs[0](event);
    expect(event.system.length).toBe(1);
    expect(event.system[0].text).toContain("Valid reasoning effort levels for this session: low, high.");
    expect(event.options.reasoningEffort).toBe("high");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/plugin.test.ts`
Expected: FAIL with import error for `../src/index.js`.

- [ ] **Step 3: Write minimal implementation**

```ts
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
    if (!parsed.success) {
      // No toast surface in server ctx; log only (quiet suppresses even this to warn).
      console.error(`[adaptive-thinking] Invalid config: ${parsed.error}`);
      return;
    }
    const config = parsed.data;
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
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run && npm run build`
Expected: all suites pass (smoke + config + variants + plugin), typecheck clean. Note: `ctx`/`event` are typed `any` deliberately because `@opencode/plugin` V2 ctx types drift across releases; mocks in tests mirror the documented shape.

- [ ] **Step 5: Commit**

```bash
git add src/index.ts tests/plugin.test.ts
git commit -m "feat: wire adaptive-thinking tool and context hook"
```

---

### Task 5: README, local-load check, publish prep

**Files:**
- Modify: `README.md`
- Modify: `package.json` (fill `@<scope>` placeholder + pin `@opencode/plugin`)

**Interfaces:**
- Consumes: Tasks 1–4 behavior
- Produces: install docs, options reference, troubleshooting, verified local load

- [ ] **Step 1: Rewrite README with exact install + options**

```md
# @<scope>/opencode-adaptive-thinking

Let the model pick its own reasoning level (OpenCode v2).

## Install

\`\`\`jsonc
{ "plugins": ["@<scope>/opencode-adaptive-thinking"] }
\`\`\`

\`\`\`sh
opencode plugin add @<scope>/opencode-adaptive-thinking
\`\`\`

## Options (all optional)

\`\`\`jsonc
{ "plugins": [{ "package": "@<scope>/opencode-adaptive-thinking", "options": {
  "enabled": true,
  "quiet": false,
  "toolName": "set_reasoning_effort",
  "toolDescription": "Set your reasoning effort",
  "systemPrompt": "…"
} }] }
\`\`\`

## Behavior

- System prompt lists only the current model's valid levels; agent calls the tool to switch.
- Switches are sticky until the next switch; model change clears stale levels.
- No valid levels → tool reports failure; prompt injection continues without the Valid list.

## Troubleshooting

- `no valid … levels` → active model/provider exposes no variants.
- `Invalid … level` → use a level from the system prompt list.
- `reasoningEffort` is OpenAI-side; Anthropic thinking models use `thinking.budgetTokens` — set effort on the matching provider model.
- Restart TUI / use a fresh session after config changes.
```

- [ ] **Step 2: Fill scope + pin dependency, reinstall, rerun all**

Run: `npm install && npm test && npm run build`
Expected: green. `package.json` `name` no longer contains `<scope>`; `@opencode/plugin` pinned to the version matching the target OpenCode v2 build.

- [ ] **Step 3: Local-load verification (manual, record results in commit message body)**

Run: copy/symlink repo into `.opencode/plugins/adaptive-thinking` of a scratch project, start OpenCode v2, open a fresh session, confirm (a) guidance text present, (b) `low→high` switch applies on next dispatch, (c) invalid level error, (d) `enabled:false` no-op.
Expected: all four observed; paste observations into commit body.

- [ ] **Step 4: Commit**

```bash
git add README.md package.json
git commit -m "docs: add install/options/troubleshooting and finalize package identity"
```

---

## Self-review (run before handoff)

1. Spec coverage: §1 arch → Task 1+4; §2.1 config → Task 2; §2.2 tool → Task 4; §2.3 variants → Task 3+4; §2.4 hook → Task 4; §3 flow → Task 4 tests; §4 errors → Tasks 2+4; §5 testing/publish → Tasks 1–5. Storage audit explicitly cut per YAGNI (spec marked best-effort).
2. Placeholder scan: only remaining placeholder is `@<scope>` in Task 1/5, resolved in Task 5 Step 2 — no TBD/TODO, no "appropriate/handle edge cases" vagueness, every code step ships concrete code.
3. Type consistency: `Config`, `parseConfig`, `buildSuffix`, `VariantStore`, `resolveValidLevels`, `pruneStale`, `ModelRow` spelled identically across tasks; tool returns `{ content }`; hook uses `event.system`/`event.options.reasoningEffort`/`event.sessionID` everywhere.
