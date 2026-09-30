# Findings: opencode-adaptive-thinking repo

Repo: https://github.com/ian-pascoe/opencode-adaptive-thinking
Stars/forks at fetch time: 20 stars, 3 forks, 1 watcher.
Stack: TypeScript plugin for OpenCode, `src/index.ts` (~11.5kB), `src/config.ts`, `src/index.test.ts`, built with rolldown, `pnpm` workspace.

Raw sources fetched:
- https://raw.githubusercontent.com/ian-pascoe/opencode-adaptive-thinking/main/src/index.ts
- https://raw.githubusercontent.com/ian-pascoe/opencode-adaptive-thinking/main/src/config.ts
- Listing via https://api.github.com/repos/ian-pascoe/opencode-adaptive-thinking/contents/src
- View: https://github.com/ian-pascoe/opencode-adaptive-thinking/blob/main/src/index.ts
- View: https://github.com/ian-pascoe/opencode-adaptive-thinking/blob/main/src/config.ts
- README rendered at https://github.com/ian-pascoe/opencode-adaptive-thinking (main branch, 19 commits)

## 1. Reasoning modes offered

No hardcoded enum. Modes = current model's valid `model.variants` keys, discovered at runtime via `getModelVariants(model) => Object.keys(model.variants)` in `src/index.ts`.

README examples: `none`, `low`, `medium`, `high`, `xhigh`.
Actual valid set varies per provider/model. If empty, tool and system injection no-op / error.

Resolution path in `resolveValidVariants(sessionID, model?)`:
1. If `model` passed to `experimental.chat.system.transform`, use its `variants` directly.
2. Else fetch `client.session.messages`, find latest message with `info.model.{providerID,modelID}`, then `client.provider.list()` → `provider.models[modelID].variants`.
3. If still empty → return `[]`.

Cached session state (`currentVariant` / `persistedVariant`) is only reused if still included in current `variants`; model switch invalidates stale levels. System prompt always lists only current-session valid levels.

## 2. How agent picks mode

Mechanism = system-prompt injection + self-invoked tool:

- Hook: `experimental.chat.system.transform` appends adaptive guidance + `Current reasoning effort level: <variant>` (if known) + `Valid reasoning effort levels for this session: a, b, c` + `To change ... use the \`set_reasoning_effort\` tool ... Only call it when task complexity justifies changing levels.`
- Tool: default name `set_reasoning_effort` (configurable via `toolName`), description default `Set your reasoning effort`.
  - Args (zod via `tool.schema`): `level: string` (must be in valid variants), `persist: boolean = false`.
  - Execution: validates `level`, resolves current model via `resolveLatestModelInfo`, calls `client.session.promptAsync({ path:{id:sessionID}, body:{ noReply:true, parts:[{type:"text", text:"Reasoning effort set to <level>", synthetic:true, ignored:true }], agent, variant:level, model:currentModel } })` to switch variant. Updates LRU `SessionStateCache` (max 500 sessions).
- Agent is expected to call tool autonomously; no UI buttons, no automatic heuristic switching in code — all adaptation is LLM-driven.

State type (`src/index.ts`):
```ts
type SessionState = {
  currentVariant?: string;
  persistedVariant?: string;
  temporaryResetVariant?: string;
  temporaryResetAgent?: string;
  temporaryResetModel?: { providerID: string; modelID: string };
}
```

## 3. Triggers

Prompt-directed (not code-enforced), from `defaultSystemPrompt` in `src/config.ts`:
- Reassess at turn start, after meaningful new evidence, when task shifts.
- Lower before trivial/routine turns; raise for ambiguity, debugging, risky changes, multi-step synthesis.
- `NEVER leave current level unchanged by inertia, NEVER reply to trivial turn before considering downshift.`
- README paraphrase: `Actively choose the lowest reasoning effort that can safely complete the task.`

Code-enforced triggers:
- `persist=false` (default, temporary): stores `temporaryResetVariant = persistedVariant ?? resolveCurrentVariant()` + agent + model; on `event.type === "session.idle"` sends synthetic `Reasoning effort reset to <variant>.` with stored agent/model and clears temp fields. Applies only for remainder of current turn.
- `persist=true`: sets `persistedVariant=level`, clears temp reset fields; survives `session.idle`.
- `session.idle` with no pending temp reset → no-op.
- Config `enabled=false` → plugin returns `{}` (no tool, no hooks).
- Invalid config → error toast (unless `quiet=true`) + `client.app.log(service:"opencode-adaptive-thinking", level:"error")`, return `{}`.

## 4. Prompts (verbatim)

Default `systemPrompt` (`src/config.ts:defaultSystemPrompt`):
> `You MUST manage reasoning effort actively. Lower it before trivial or routine turns; raise it for ambiguity, debugging, risky changes, or multi-step synthesis. Reassess at turn start, after meaningful new evidence, and when the task shifts. NEVER leave the current level unchanged by inertia, and NEVER reply to a trivial turn before considering a downshift.`

System transform suffix (`src/index.ts`):
```
<config.systemPrompt.trim()> [Current reasoning effort level: <variant>. ]Valid reasoning effort levels for this session: <csv>. To change your reasoning effort, use the `<toolName>` tool with one of the valid levels. Only call it when the task complexity justifies changing levels.
```

Synthetic variant-switch prompts (invisible, `synthetic:true, ignored:true, noReply:true`):
- Set: `Reasoning effort set to <level>`
- Reset on idle: `Reasoning effort reset to <variant>.`

Tool arg descriptions:
- `level`: `The level of reasoning effort to apply. Higher levels may result in more accurate and thoughtful responses, but may also take more time and resources.`
- `persist`: `Whether to persist the setting for this session, otherwise it will only apply for the remainder of the current turn`

Error strings returned to agent:
- `Failed to set reasoning effort: no valid reasoning effort levels are available for this session`
- `Invalid reasoning effort level: <level>. Valid levels: <csv>.`
- `Failed to set reasoning effort: <promptAsync error>`
- Success: `Reasoning effort set to <level>`

## 5. Config required

Requirements:
- OpenCode with plugin support compatible with `@opencode-ai/plugin@^1.14.24`.
- Selected model must expose reasoning-effort variants; otherwise tool errors as above.

Minimal install (`opencode.json`):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": ["opencode-adaptive-thinking"]
}
```

Full optional config (tuple form, defaults shown):
```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [[
    "opencode-adaptive-thinking",
    {
      "enabled": true,
      "quiet": false,
      "toolName": "set_reasoning_effort",
      "toolDescription": "Set your reasoning effort",
      "systemPrompt": "Actively choose the lowest reasoning effort that can safely complete the task. Raise effort for ambiguity, debugging, risky changes, or multi-step synthesis."
    }
  ]]
}
```

Keys (`src/config.ts:ConfigSchema`, zod v4, all optional with defaults):
- `enabled: boolean=true` — disable without uninstall.
- `quiet: boolean=false` — suppress config-error toasts (still logs).
- `toolName: string="set_reasoning_effort"`
- `toolDescription: string="Set your reasoning effort"`
- `systemPrompt: string=defaultSystemPrompt` (above)

Troubleshooting per README:
- `no valid ... levels` → active model/provider lacks variants.
- `Invalid ... level` → use levels listed in system prompt.
- Config errors → check keys/types; set `quiet:true` to silence toasts.
