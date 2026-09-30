# Design: V2 Adaptive-Thinking Plugin (simplified redo)

Date: 2026-09-29
Status: approved in brainstorming (§1–§5)
Goal: npm-installable OpenCode v2 plugin that injects adaptive-thinking guidance into the system prompt and exposes a tool for switching to one of the current model's valid reasoning-effort variants. LLM self-selects; no deterministic heuristic router.
Prior research: `research/findings_adaptive_thinking_repo.md`, `findings_opencode_v2_plugins.md`, `findings_reasoning_modes.md`, `findings_minimal_config_design.md`.
Target: OpenCode v2, Promise API.

## 1. Architecture

- Package name: `@<scope>/opencode-adaptive-thinking` (placeholder scope; fill before publish).
- `package.json`: `type:module`, `exports.{.: ./src/index.ts}`, `dependencies: {@opencode/plugin: <v2-compatible>}`. No `effect` dep. Optional `./rpc` omitted (no RPC surface).
- Entry `src/index.ts`: `export default Plugin.define({ id: \"adaptive-thinking\", async setup(ctx) {...} })`.
- Install: `plugins: [\"@<scope>/opencode-adaptive-thinking\"]` or `{package, options}` form; also `opencode plugin add @<scope>/opencode-adaptive-thinking`.
- `setup` registers exactly two things:
  1. `ctx.tool.transform` adding one tool (default `set_reasoning_effort`).
  2. `ctx.session.hook(\"context\")` injecting system guidance + applying stored level via `event.options.reasoningEffort`.
- State: in-memory `Map<sessionID, level>` for sticky level. Optional `ctx.storage` audit (`classification/selection`) — best-effort, not required for correctness. No `session.idle` listener, no synthetic messages, no LRU eviction beyond bounded Map (cap 500, drop oldest).
- Cleanup: return `() => { registrations.dispose(); map.clear(); }`.

Non-goals: heuristic scorer, LLM classifier, `/reasoning` command, model swapping, Effort RPC/TUI, Effect API.

## 2. Components

### 2.1 Config (`ctx.options`, all optional, zod-validated)

- `enabled: boolean = true` — `false` → `setup` returns `{}` immediately.
- `quiet: boolean = false` — suppress config-error toasts (still log).
- `toolName: string = \"set_reasoning_effort\"`.
- `toolDescription: string = \"Set your reasoning effort\"`.
- `systemPrompt: string = default` — default: `You MUST manage reasoning effort actively. Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. Reassess at turn start, after meaningful new evidence, and when the task shifts. NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.`
- Invalid config → error toast (unless `quiet`) + log, return `{}` (no tool, no hook).

### 2.2 Tool

- Registration via `editor.add({ name: toolName, description: toolDescription, input: {type:object, properties:{level:{type:string}}, required:[level], additionalProperties:false}, execute })`.
- No `persist` flag (always sticky per decision).
- `execute(level, context)`: resolve current session model → `valid = await resolveVariants()` → if empty return `Failed to set reasoning effort: no valid reasoning effort levels are available for this session`; if `!valid.includes(level)` return `Invalid reasoning effort level: <level>. Valid levels: <csv>.`; else `map.set(sessionID, level)`, optional storage audit, return `Reasoning effort set to <level>`.
- `level` description: `The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources.`

### 2.3 Variant resolution (runtime only, no hardcoded enum)

- Primary: `ctx.model.list()` filtered to current session's `providerID/modelID` → `model.variants` keys (or equivalent variant list).
- Current model source: latest session context if available; else omit filter and use union with warning (documented fallback).
- System prompt always lists only current-session valid levels. Sticky value reused only if still in `valid`; model switch with stale value → clear entry, inject without `Current`.
- Examples (not exhaustive): `none, low, medium, high, xhigh` — actual set varies per provider/model.

### 2.4 Context hook

- `await ctx.session.hook(\"context\", (event) => { event.system.push({type:\"text\", text: suffix}); if (level) event.options.reasoningEffort = level; })`.
- Suffix: `<systemPrompt.trim()>[ Current reasoning effort level: <level>.] Valid reasoning effort levels for this session: <csv>. To change your reasoning effort, use the \`<toolName>\` tool with one of the valid levels. Only call it when the task complexity justifies changing levels.` (omit `Current...` sentence when unknown; omit `Valid...` sentence when empty).
- Provider without `reasoningEffort` support → leave `options` untouched, still inject prompt.
- Affects only outgoing call; history/config untouched.

## 3. Data flow (always sticky)

1. Turn start → context hook injects guidance + current/valid + applies stored level.
2. Agent reassesses (trivial → consider downshift; ambiguity/debug/risky/multi-step → consider upshift).
3. Optionally calls `set_reasoning_effort(level)` → validated → `Map` updated.
4. Next dispatch hook applies new level. Persists across turns/idle until next switch or invalidated by model change.
5. No auto-reset, no synthetic `Reasoning effort set/reset` messages.

## 4. Error handling

| Case | Behavior |
|---|---|
| `enabled=false` | no-op `{}` |
| invalid config | toast (unless `quiet`) + log + `{}` |
| no valid levels | tool error string; hook injects guidance without Valid list |
| invalid level | `Invalid ... Valid: <csv>` |
| provider lacks `reasoningEffort` | skip options write, keep prompt |
| model switch invalidates sticky | clear entry silently |

## 5. Testing + publish

- Unit: config schema defaults/rejects; variant resolution (known model, unknown model, empty); tool validation messages; sticky Map set/overwrite/invalidate; suffix text with/without current/valid.
- Integration (local `.opencode/plugins/` load): fresh session shows guidance; `low→high` switch reflected in next `context` options; invalid level error; `enabled=false` no-op; model switch clears stale.
- README: install (`plugins[]` + `plugin add`), full options JSON with defaults, troubleshooting (`no valid levels` → model lacks variants; `Invalid level` → use listed levels; wrong-schema pitfalls: `reasoningEffort` is OpenAI-side, Anthropic uses `thinking.budgetTokens`; typo'd model IDs silently fall back; restart TUI/fresh session to pick up config).
- Publish: `npm publish`, `type:module`, versioned `@opencode/plugin` dep matching target OpenCode v2.

## 6. Open items before plan

- Fill `@<scope>` placeholder.
- Pin `@opencode/plugin` version against target OpenCode v2 build.
- Confirm `ctx.model.list()` variant shape on target build (keys vs objects); adjust `resolveVariants` accordingly during implementation.
