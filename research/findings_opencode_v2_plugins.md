# OpenCode v2 Plugin Development — Findings

Date: 2026-09-27
Sources: `https://opencode.ai/v2/docs/build/plugins`, `https://opencode.ai/v2/llms.txt`, `https://opencode.ai/v2/docs/config`, plus `/v2/docs/plugins`, `/v2/docs/build/plugins/rpc`, `/v2/docs/build/plugins/cli`, `/v2/docs/build/plugins/effect`, `/v2/docs/build/plugins/migrate-v1`.

## 1. Mental model

- V2 server plugin default-exports `Plugin.define({ id, setup(ctx) })` (Promise API, `import { Plugin } from "@opencode/plugin"`) or `Plugin.define({ id, effect(ctx) })` (Effect API, `import { Plugin } from "@opencode/plugin/effect"` + `effect` dep).
- `setup` runs on load; may return cleanup fn. `effect` runs on load; scope closes on unload (use `Effect.addFinalizer`, `forkScoped`).
- `ctx` is essentially a typed OpenCode server client + plugin-only methods: transforms, runtime hooks, reloads, registrations, options, storage, RPC, events.
- CLI/TUI plugins are separate kind: `import { Plugin } from "@opencode/plugin/tui"`, exposed via `./tui` export, configured in `cli.json`.
- RPC definitions are shared via `./rpc` export using `Rpc.define` from `@opencode/plugin/rpc`.

Minimal server plugin (local file):

```ts title=".opencode/plugins/example/index.ts"
import { Plugin } from "@opencode/plugin"

export default Plugin.define({
  id: "example",
  async setup(ctx) {
    await ctx.storage.set("loaded", true)
  },
})
```

Minimal Effect plugin:

```ts title=".opencode/plugins/concise/index.ts"
import { Plugin } from "@opencode/plugin/effect"
import { Effect } from "effect"

export default Plugin.define({
  id: "example",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* ctx.storage.set("loaded", true)
    }),
})
```

## 2. Plugin package layout

### Local (auto-discovered)

```
.opencode/
└── plugins/
    ├── concise.ts          # direct .ts/.js file -> plugin
    ├── reviewer.js
    └── acme-package/       # immediate package dir -> plugin
        ├── package.json    # optional (no install gate)
        └── index.ts
```

- Same layout globally under `~/.config/opencode/plugins/`.
- V2 discovers both `.opencode/plugin/` and `.opencode/plugins/` (use plural for V2). Keep supporting modules beside entrypoint.
- A `plugins/` dir beside project-root `opencode.json(c)` is NOT auto-discovered; must list explicitly or move under `.opencode/`.
- Local plugins skip npm compatibility gate (treated as dev code).

### Published npm package

```
opencode-acme-plugin/
├── package.json            # name, version, type:module, exports, deps
├── src/
│   ├── index.ts            # "." / main entry: default export Plugin.define
│   ├── rpc.ts              # "./rpc": Rpc.define shared types
│   └── tui.tsx             # "./tui": CLI plugin (optional)
└── README.md
```

Minimal `package.json` (Promise/server):

```json
{
  "name": "opencode-acme-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./rpc": "./src/rpc.ts"
  },
  "dependencies": {
    "@opencode/plugin": "latest"
  }
}
```

Effect package:

```json
{
  "name": "opencode-acme-effect-plugin",
  "version": "1.0.0",
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "dependencies": {
    "@opencode/plugin": "latest",
    "effect": "4.0.0-rc.111"
  }
}
```

CLI + server combo:

```json
{
  "name": "opencode-acme-plugin",
  "type": "module",
  "exports": {
    ".": "./src/index.ts",
    "./tui": "./src/tui.tsx"
  },
  "dependencies": { "@opencode/plugin": "latest" },
  "peerDependencies": {
    "@opentui/core": ">=0.5.8",
    "@opentui/solid": ">=0.5.8",
    "solid-js": ">=1.9.0"
  }
}
```

Dual V1+V2 example (from `opencode-engram-learning` pattern):

```json
{
  "main": ".opencode-plugin/entry.ts",
  "exports": { ".": ".opencode-plugin/entry.ts", "./server": ".opencode-plugin/entry.ts", "./v2": ".opencode-plugin/v2.ts" }
}
```

## 3. package.json entrypoints

| Kind | Resolution order (from `packages/opencode/src/plugin/{shared,install}.ts` + docs) |
|---|---|
| `server` (default) | `exports["./server"]` if present, else `main`, else directory-index fallback. For V2 Promise/Effect the `"."` export is the documented entry (`src/index.ts`). |
| `tui` (CLI) | `exports["./tui"]` only; theme-only packages also count as `tui`. No `main` fallback. |
| `rpc` | Not a load kind; plain importable subpath (`opencode-acme-plugin/rpc`) exporting `Rpc.define`. Used by `ctx.rpc(Acme)` / `client.rpc(Acme)` / `context.client.rpc(Acme)`. |

Details:

- Export value can be string path or `{ opts }` object form (install path).
- Must use `"type": "module"`.
- Depend on `@opencode/plugin` version compatible with targeted OpenCode release; Effect plugins also pin `effect` (e.g. `4.0.0-rc.111` in docs).
- V1 compat: default export object spreads `Plugin.define(...)` + adds `async server()` returning V1 hooks. V1 (`>=1.18.29`) calls `server()`; V2 reads `id`+`setup()`/`effect()`, ignores `server()`.

```ts
export default {
  ...Plugin.define({
    id: "example",
    async setup(ctx) {
      await ctx.tool.hook("execute.before", () => console.log("tool runs"))
    },
  }),
  async server() {
    return { "tool.execute.before": async () => console.log("tool runs") }
  },
}
```

## 4. Install via `opencode.json(c)` `plugins` field

Config file: `opencode.json`/`opencode.jsonc`, `$schema: https://opencode.ai/config.json`. Locations merged low→high: `~/.config/opencode/opencode.json(c)` → parent `opencode.json(c)` chain → closest → `.opencode/opencode.json(c)` chain (every `.opencode` config overrides every direct config). `plugins` arrays concatenate, not replace.

```jsonc
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": [
    "opencode-acme-plugin",
    "opencode-acme-plugin@1.2.0",
    "@acme/opencode-plugin",
    "./plugins/local",
    "../shared/plugin",
    "../shared/plugin.ts",
    "/absolute/path/plugin.ts",
    "file:///home/me/plugins/local",
    {
      "package": "@acme/opencode-plugin",
      "options": { "agent": "reviewer", "strict": true }
    }
  ]
}
```

- String form = package/dir with no options. Object form `{ "package": "...", "options": {...} }` passes `ctx.options`.
- Relative paths resolve from the config file containing the entry.
- Accepted: npm names + `@version`/tag/range, scoped, relative/absolute/file:// dirs or direct `.ts`/`.js` files, git specs via CLI (`github:acme/plugin`, `git+ssh://...#main`, `::path:` subdirectory). `plugin add` rejects tarball/npm-alias targets.
- Control: `"*"`, `"-<id>"`, `"-prefix.*"` enable/disable in order; later re-enables. Builtins `opencode.config.policy` + `opencode.provider.opencode` ignore removal.
- Read options in setup: `const strict = ctx.options.strict === true`.

CLI management (global package plugins):

```sh
opencode plugin add opencode-acme-plugin@1.2.0
opencode plugin add @acme/opencode-plugin@latest
opencode plugin add github:acme/opencode-plugin
opencode plugin list
opencode plugin list --builtin
opencode plugin check
opencode plugin update [pkg]
opencode plugin remove opencode-acme-plugin@1.2.0
```

CLI-only plugins go in `cli.json` (not `opencode.jsonc`):

```json
{ "plugins": ["opencode-acme-cli"] }
```

## 5. Local vs npm loading

| Aspect | Local (`./`, `../`, `/abs`, `file://`, `.opencode/plugins/`) | npm (`name`, `name@ver`, `@scope/name`, git) |
|---|---|---|
| Discovery | `.opencode/plugins/` auto-loads `.ts`/`.js` files + immediate package dirs. Other paths require `plugins` entry. | Must be in `plugins` (or added via `opencode plugin add`). |
| Install | Loaded directly, no install. External deps via `.opencode/package.json` + `bun install` at startup. | Installed via Bun at startup into cache (`~/.cache/opencode/node_modules/` in V1 docs; V2 caches + background-installs missing packages, serves cached immediately). |
| Versioning | No version; exact file/dir. | Supports `@1.2.0`/tag/range; exact versions + full git hashes stay pinned, unpinned checked for updates at startup without auto-changing install. `plugin check/update` skips exact revisions + local plugins. |
| Compat gate | Skipped (dev code). | `npm` source checks declared OpenCode version range (`InstallationVersion`); failure = `compatibility` skip with error. |
| Reload | Watched config dirs reload auto; `touch .opencode/plugins/...` + `opencode service restart` may be needed for unwatched deps. | Startup loads cached, installs missing in background. |
| Dedup/order | All sources loaded; hooks run in plugin order; later transforms see earlier. | Duplicate name+version loaded once. Local + npm with similar names load separately. Config order: global config → project config → global plugin dir → project plugin dir (V1 doc); V2 precedence low→high config merge. |

## 6. Context capabilities (`ctx` in `setup`)

Promise `ctx` ≈ OpenCode server client + plugin APIs. Effect `ctx` same domains but Effect/Stream returns.

Core: `ctx.app.version`, `ctx.location.{directory, workspaceID?, project:{id,directory,canonical}}`, `ctx.options`, `ctx.storage.{get,set,remove,scan}`, `ctx.event.subscribe({signal})`, `ctx.plugin.list()`, `ctx.generate.text({model,prompt})`, `ctx.rpc.register(Acme, impl)` / `ctx.rpc(Acme)`.

Domain APIs (each: `list`/`get` reads + `transform(editor=>void): Registration` + `reload()`; registrations `dispose()`):

- `agent` — list/get/default/update/remove.
- `provider` — add/update/remove + `models.{set,update,remove}`; `sourceConnection` for per-account inventory.
- `model` — full candidate collection; `list(providerID?)`, `update`, `remove`, `default.{get,set}`, `provider` immutable source view.
- `command` — `editor.add({name,description,execute({sessionID,prompt,delivery})})`.
- `integration` — list/get/connect.key/oauth/command flows, `connection.{active,resolve}`, transform methods.
- `mcp` — `set/update/remove/list/get`; `disabled` flag drives connect/disconnect.
- `reference` — `add(name,{type:local,path}|{type:git,repository,branch})`.
- `skill` — `add/update/remove` with `{id,name,description,location,content,autoinvoke?}`.
- `tool` — see §7.
- `vcs` — get/branches/status/diff + `editor.add({id,name,info,branches,status,diff})`, `default.set`.
- `worktree` — `create/list/refresh/remove({projectID,...})` + `editor.add({id,create,remove,list})`; last registration wins; `throw new Worktree.OperationError({message,forceRequired})` for force flow.
- `websearch` — providers/query + `editor.add({id,name,execute})`, `default.set(id|false)`.
- `session` — create/get/context/switchAgent/switchModel/prompt/generate/command/synthetic/interrupt/rename/wait + hooks (see §8).
- `permission` — list/get/reply/rules({sessionID,permissions}).
- `shell` — hooks (Promise) / Effect hooks.
- `storage` — plugin-scoped durable JSON.

Lifecycle:

```ts
setup(ctx) {
  console.log(ctx.app.version, ctx.location.directory, ctx.location.project.canonical)
  const strict = ctx.options.strict === true
  const timer = setInterval(refresh, 60_000)
  return () => clearInterval(timer) // + AbortController.abort() for event loop
}
```

Events:

```ts
const controller = new AbortController()
void (async () => {
  for await (const event of ctx.event.subscribe({ signal: controller.signal })) console.log(event.type)
})()
return () => controller.abort()
```

## 7. Tools

List outside transform: `await ctx.tool.list()` → `{id (effective name), ...}`.

Register synchronously (Promise):

```ts
const reg = await ctx.tool.transform((editor) => {
  editor.namespace({ name: "acme", description: "Customer tools" })
  editor.add({
    name: "greeting",
    description: "Create a greeting",
    input: { type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false },
    options: { namespace: "acme", codemode: true },
    execute: async (input, context) => {
      await context.progress({ status: "greeting" })
      return { content: `Hello ${(input as {name:string}).name}!` }
    },
  })
})
await ctx.tool.reload()
await reg.dispose()
```

Effect variant uses `Schema.Struct` for `input`/`output`, `execute: ({name}, context) => Effect.gen(...)` returning `{output, content?, metadata?}`, `yield* context.progress(...)`, `signal` for cancellation.

Editor semantics: `list()/get(id)` inspect; `update(id, fn)` / `remove(id)` use effective name (`acme_greeting`; dots/invalid chars → `_`); assign new schemas/options rather than deep-mutate; invalid updates logged, prior def kept; later valid registration overrides same name; each model request snapshots tools (later transforms affect future snapshots only); pass `context.signal` to `fetch`.

Tool hooks: `ctx.tool.hook("execute.before"|"execute.after", cb)` — before can replace input or throw/`Effect.fail(new Tool.Error(...))`; after can inspect/replace result. V1→V2: `tool` map + `tool.definition` → `ctx.tool.transform`; `tool.execute.before/after` → `ctx.tool.hook(...)`.

## 8. Hooks

Pattern: `const reg = await ctx.session.hook("context", (event)=>{} [, {providerID}]); await reg.dispose()`. Multiple plugins same hook run in plugin order.

Session hooks:

| Hook | When / mutates |
|---|---|
| `prompt` | Before attachment/skill resolution + durable admission. Mutable `prompt{text,files,agents,skills}`, `metadata`, `delivery ("steer"\|"queue")`. IDs readonly. Retry-safe (no typed reject; failed prep = no admission). Commands via `session.prompt` run it; synthetic/shell/compaction/move do not. |
| `context` | Before each agent-loop dispatch. `event.system[]`, `event.messages`, `event.tools` (delete to hide), `event.options` (semantic keys: `temperature`, `maxTokens`, `reasoningEffort`, provider-scoped via `{providerID}`), raw overlays. History/config untouched. |
| `compaction` | Transcript summary; `event.messages`; set `event.result={summary}` to skip model call. |
| `generate` | Transient `ctx.session.generate` calls. |
| `title` | Title gen; no agent/tools; set `event.result="..."` to supply title. Must register each kind separately for full coverage. |
| `model.request` | Semantic model-request settings + `headers`; optional `{providerID}`; `event.kind` = primary/compaction/title/generate. |
| `http.request` / `http.response` | Native provider HTTP; bodies one-shot (clone/replace before read); set headers e.g. `x-session-id`. |
| `experimental.ws.handshake/send/receive` | WebSocket providers (one conn/session). Handshake edits `url`/`headers` (reopens socket); send/receive edit string `frame` unvalidated. |
| `retry` | After classification, before schedule. `event.{error{type,message,status},attempt,decision{retry,delay}}`. Initial req attempt=1. Max attempts hard cap; NaN/neg/∞ delays fallback. Can make terminal retryable or veto. |

Other hook domains:

- `ctx.tool.hook("execute.before"/"execute.after")`, `ctx.shell.hook("create.before", e=>{e.command,e.cwd,e.timeout,e.shell,e.env})`, `ctx.permission.hook("evaluate",...)` (V1 `permission.ask` → V2 evaluate), plus Effect-only `ctx.session.hook(...)` returning Effects.
- No 1:1 V2 for `command.execute.before` (use `ctx.command.transform` if you own command, else `prompt` hook) nor every experimental V1 (`autocontinue`, `small_model`, `text.complete` — re-evaluate vs V2 session/provider/model/event APIs).

Example:

```ts
await ctx.session.hook("prompt", (event) => {
  event.prompt.text = event.prompt.text.replaceAll("company-secret", "[redacted]")
  event.delivery = "queue"
})
await ctx.session.hook("context", (event) => {
  event.system.push({ type: "text", text: "Keep review focused." })
  delete event.tools.write
  event.options.temperature = 0.2
})
await ctx.session.hook("retry", (event) => {
  if (event.error.status === 429) event.decision = { retry: true, delay: 10_000 }
  else if (event.attempt >= 3) event.decision = { retry: false }
})
```

## 9. Transforms

- Sync callbacks editing domain state; replayed in registration order onto fresh value on every `reload()` or registration change. Reads (e.g. `ctx.model.list()`) reflect all registrations so far; startup batching only coalesces notifications.
- Keep cheap/repeatable, no one-time side effects inside; load external data before, capture in closure, call domain `reload()` on change (`ctx.provider.reload()` invalidates whole model result; `ctx.model.reload()` for model-only inputs).
- Provider transforms contribute sources + immutable defs first; model transforms then filter/override active candidates. Disabled candidates stay editable until all transforms finish.
- `await ctx.provider.transform(e=>{e.add({info,models,sourceConnection?}); e.update(...); e.models.set/update/remove(...)})`, `await ctx.model.transform(...)`, same shape for agent/command/integration/mcp/reference/skill/tool/vcs/worktree/websearch.
- `Registration.dispose()` removes that transform and rebuilds; unloading plugin disposes all.

Provider+budget example:

```ts
const providerID = Provider.ID.make("acme")
await ctx.provider.transform((editor) => {
  editor.add({ info: { ...Provider.Info.empty(providerID), name: "Acme", activation: "enabled", package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: "http://127.0.0.1:8000/v1" } }, models })
})
await ctx.model.transform((editor) => {
  editor.list().filter(m => m.cost.some(t => t.output > 20)).forEach(m => editor.remove(m.providerID, m.id))
})
```

Refresh pattern:

```ts
const source = { providers: await loadFromSource() }
await ctx.provider.transform((e) => source.providers.forEach(p => e.add(p)))
const timer = setInterval(async () => { source.providers = await loadFromSource(); await ctx.provider.reload() }, 60_000)
return () => clearInterval(timer)
```

## 10. RPC + CLI extras (for completeness)

- RPC: `Rpc.define({id, methods:{name:{input?,output?,errors?}}, events:{name:{schema: object}}})` supports JSON Schema or Standard Schema (Zod/Valibot/ArkType). Implement in `setup` via `ctx.rpc.register(Acme, {search: async (input, context)=>...})`; call via `ctx.rpc(Acme).search(...)`, HTTP via `client.rpc(Acme)`, TUI via `context.client.rpc(Acme)`; events via `registration.events.emit(...)` / `events.on` / `events.subscribe`. Errors via `context.error("not_found", msg, data)`; `rpc.*` names reserved; event data must be object.
- CLI (`@opencode/plugin/tui`): `context.{app,location,client,renderer,theme,options,data,storage,ui,markdown,keymap,attention}`; `data.on/listen`, `data.session.*`, `data.location.*`, `ui.toast/dialog/router/tabs/slot/panel/model/format`, `keymap.layer/dispatch`, `storage.store/memory`, `markdown.registerCodeBlockRenderer`. Publish via `./tui`.

## 11. Source URLs

- https://opencode.ai/v2/docs/build/plugins
- https://opencode.ai/v2/llms.txt
- https://opencode.ai/v2/docs/config
- https://opencode.ai/v2/docs/plugins
- https://opencode.ai/v2/docs/build/plugins/rpc/
- https://opencode.ai/v2/docs/build/plugins/cli/
- https://opencode.ai/v2/docs/build/plugins/effect/
- https://opencode.ai/v2/docs/build/plugins/migrate-v1/
