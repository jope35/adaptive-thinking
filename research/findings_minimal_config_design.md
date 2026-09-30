# Minimal-Config Design for OpenCode v2 Adaptive Reasoning Plugin

Goal: auto-select reasoning depth with **zero user config** — install plugin, it works. Optional overrides allowed but not required.

## 1. OpenCode v2 extension points usable with no config

All below work from `Plugin.define({ id, setup(ctx) })` in `.opencode/plugins/` or package in `plugins: [...]`. Transforms are synchronous + replayable; hooks are mutable-event interceptors. No `opencode.jsonc` changes required except adding the plugin name.

### 1.1 `ctx.session.hook("prompt", ...)` — cheapest classification point
- Runs once per user prompt **before** attachment/skill resolution and durable inbox admission.
- Mutable draft: `event.prompt.{text,files,agents,skills}`, `event.metadata`, `event.delivery ("steer"|"queue")`.
- Use for: heuristic scoring (length, keywords, file scope, @mentions) + stash `metadata.reasoningEffort/difficulty/score` for later hooks. Can also inject skills/files (e.g. add verifier skill).
- Limits: runs once, not before every model call; no provider scoping (model resolution happens after); must be retry-safe (retried IDs don't rerun hooks; concurrent submissions can run >1x); no typed rejection.
- Source: https://opencode.ai/v2/docs/build/plugins (Session Hooks > Prompt admission)

### 1.2 `ctx.session.hook("context" | "compaction" | "generate" | "title", ...)` — apply depth
- Runs immediately before model dispatch. `context` = agent loop (incl. tool continuations). Must register separately per kind if needed.
- Mutable: `event.system[]` (push instruction), `event.messages`, `event.tools` (e.g. `delete event.tools.write`), `event.options`.
- `event.options` starts empty per call; typed keys = generation settings, other keys = provider options (merge recursively). Takes precedence over model defaults > route defaults. `undefined`/delete falls back to defaults.
- Canonical minimal-config pattern for effort:
```ts
await ctx.session.hook("context", (event) => {
  event.system.push({ type: "text", text: "Keep review focused on correctness." });
  event.options.temperature = 0.2;
  event.options.maxTokens = 8000;
}, { providerID: "openai" }); // optional scoping
// provider-native:
await ctx.session.hook("context", (e) => { e.options.reasoningEffort = "high"; }, { providerID: "openai" });
```
- Notes: changes affect only outgoing call, not persisted history/config. V2 docs explicitly show `reasoningEffort` for OpenAI Responses protocol; `maxTokens` semantic limit; Gemini supports `topK`, OpenAI Responses does not.
- V2 caveat: per-agent `request` body overlays in config are **preserved but not yet sent** — configure active request settings on provider/model/variant instead, or via this hook. Do not rely on legacy `temperature/top_p/prompt/permission/tools/disable/maxSteps` agent fields.
- Source: https://opencode.ai/v2/docs/build/plugins (Model requests, Provider options), https://opencode.ai/v2/docs/agents, https://opencode.ai/v2/docs/migrate-v1/

### 1.3 `ctx.session.hook("model.request" | "http.request" | "http.response" | "retry", ...)` — provider-faithful effort + escalation
- `model.request`: edit headers/settings, optionally scoped by `providerID`. `http.request/response`: native provider request/response (one-shot streams — clone/replace before reading). `event.kind: "primary"|"compaction"|"title"|"generate"` distinguishes agent loop vs aux calls (use instead of agent ID).
- `retry`: override retry decision/delay (`{retry:true, delay:ms}`), e.g. escalate effort after 429 or attempt>=N. Built-in max attempts remains hard limit.
- Use for: raw-body overlay after protocol lowering when semantic `options.reasoningEffort` insufficient; cost/audit logging; evidence-based retry at higher effort.
- Source: https://opencode.ai/v2/docs/build/plugins

### 1.4 `ctx.agent.transform(...)` — zero-config persona/depth defaults
- Synchronous editor: `list()/get()/default()/update()/remove()`. E.g. `editor.default("build")`, `editor.update("build", a=>{a.description=...})`.
- Use for: ship adaptive system-prompt snippet / default agent without user editing `opencode.jsonc` or `AGENTS.md`. Later transforms see earlier changes.
- Keep callback cheap, side-effect free; load external data before, call `ctx.agent.reload()` on change.
- Source: https://opencode.ai/v2/docs/build/plugins, https://opencode.ai/v2/docs/build/plugins/effect

### 1.5 `ctx.tool.transform(...)` + `ctx.tool.hook("execute.before"/"after", ...)` — scope tools + verify/escalate
- `transform`: `namespace/add/update/remove` with JSON Schema; later registration overrides same effective name (`namespace_name` with `_` normalization). Snapshot per model request — future snapshots only.
- `hook("execute.before"/"after")` (V1 `tool.execute.before/after` equivalent): gate runs, inject verification (`npm test`, `tsc --noEmit`), trigger escalation to next effort on failure.
- Migration: V1 `tool` map → `ctx.tool.transform`, `tool.execute.before/after` → `ctx.tool.hook`, `experimental.chat.system/messages.transform` → `ctx.session.hook("context")`, `experimental.session.compacting` → `ctx.session.hook("compaction")`, `config` → domain transforms (no global mutable config in V2).
- Source: https://opencode.ai/v2/docs/build/plugins/migrate-v1, https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/docs/opencode-v2-compatibility.md

### 1.6 Other zero-config surfaces
- `ctx.command.transform`: add `/reasoning`, `/think <low|high|auto>` override (V1 `command.execute.before` has no 1:1 global hook — own the command or use prompt hook).
- `ctx.skill.transform`: ship `auto-reasoning` SKILL.md (when/how to route, model-fixed boundary) with `autoinvoke`.
- `ctx.session.generate({sessionID, prompt})` / `ctx.generate.text({model, prompt})`: transient LLM classifier without session history — use sparingly for low-confidence cases.
- `ctx.event.subscribe()`: listen `session.created/idle`, etc. for phase memory / budget tracking.
- `ctx.storage.{get,set,scan}`: durable audit trail (classification, selection, escalation, verification) + spend/phase state, no user file needed.
- `ctx.model/provider.transform`: filter candidates by cost (`output>20` example), set default model. Keep model fixed when routing only effort.
- `ctx.session.switchAgent/switchModel`: V2 allows switching subsequent requests (note: community adapter reports TUI default-agent + per-prompt model lock limits — verify on target V2 build; prefer `options.reasoningEffort` over model swap for effort routing).
- `AGENTS.md`: auto-loaded (global + upward + nested discovery) — plugin should **not** require user to write it; prefer `session.hook("context")` system injection. Note V2 `instructions: [...]` array in config is accepted but **not resolved** — do not use.
- Sources: https://opencode.ai/v2/docs/build/plugins, https://opencode.ai/v2/docs/plugins/, https://opencode.ai/v2/docs/instructions, https://opencode.ai/v2/docs/config, https://opencode.ai/v2/docs/agents

## 2. Heuristic routing vs LLM self-selection

### Heuristic (deterministic scorer, no LLM call)
Example signals (from `auto-reasoning` + `pi-model-router` + Hermes proposal + Biba):
- `+1..+3` prompt length/detail, file scope (single/multi/wide), verification commands present
- `+2` debug/ambiguity words (`debug, investigate, flaky, race, regression`), `+1` implement/fix/refactor/migrate
- `+3` high-risk domains (`auth, security, payment, database, migration, production, privacy, concurrency`), `+1/+3/+5` explicit risk medium/high/critical, up to `+3` tags (pii, compliance)
- `-1` simple language (`typo, rename, format, summarize, quick`)
- Thresholds e.g. `<=1:minimal, <=3:low, <=6:medium, <=9:high, else:xhigh` + `confidenceFloor ~0.55` bumps one level if vague + `maxAttempts ~3` escalation ladder `minimal→low→medium→high→xhigh` on verifier/adapter failure.
- Pros: ~10ms, zero tokens, transparent/testable/auditable, reproducible, no training, ideal minimal-config default. Heuristics catch ~80% cases.
- Cons: brittle on semantic difficulty; needs per-workload tuning; misses latent difficulty.
- Evidence: fixed-low drops ~20% (gpt-oss-20b high→low), random selection fails to preserve accuracy (Ares); CDR 4-dimensions (correlation strength, domain crossing, stakeholder multiplicity, uncertainty) cuts cost 34%, uncertainty+correlation = 89% of gain.

### LLM self-selection / learned router
Patterns:
- First-token mode choice `NoThink/Short/Long` with shaped rewards + per-mode caps (`1024/3000/uncapped`) + token-mean GRPO — 41% shorter (4796→2811) at ~same MATH500 acc (0.782 vs 0.796), 76% cut on GSM8K, transfers without retraining.
- Lightweight router LM (e.g. Qwen3-1.7B) on history predicting lowest sufficient effort — up to 52.7% reasoning tokens saved; early steps low, later/error-correction (`go back`, `branch`) high.
- Joint model+strategy router (RTR): learnable embeddings predict performance + tokens per pair, 60%+ token cut at higher accuracy; binary think/no-think routing on Qwen3-4B works.
- Cheap classifier model (~100ms) for `complexityScore 1-10, taskType, requiresWorldKnowledge` → tier (`SYSTEM_1 / SYSTEM_2_LITE / SYSTEM_2_DEEP / EXTENDED_ARCHITECT`); structured tasks → small model + high reasoning (avoids overthinking), ambiguous → large + extended.
- Plug-and-play ranking router: ranking-aware + checklist-probe features → regression on Think-minus-NonThink margin + Pareto-frontier policy; e.g. +6.3% NDCG@10 with -49.5% tokens.
- Pros: captures semantics/uncertainty; better on ambiguous/multi-step; monotonic effort frontier within one model (preserves KV cache vs model-swap).
- Cons: extra latency/cost; routing-collapse risk (needs warmup/caps/balance penalty/importance sampling/curriculum); calibration/threshold needed; less auditable; overthinking risk if budget too high (redundant verification, worse answers — e.g. R1 42s on 0.9 vs 0.11).

## 3. Minimal-config design options (pick one default + one override)

**Option A — Pure heuristic in `prompt`+`context` hooks (recommended default, zero LLM cost)**
- `prompt` hook scores text+files+skills → `metadata.effort`; `context` hook maps to `options.reasoningEffort/maxTokens` + trims `system/tools` for `minimal/low`.
- Config: none. Policy JSON with defaults baked in; `ctx.options` only if user wants to tune thresholds.
- Best when: coding plugin must work offline/cheaply, auditable.

**Option B — Heuristic + evidence escalation (recommended companion to A)**
- A + `tool.hook("execute.after")` verifiers (`npm test`, `tsc --noEmit`) + `retry` hook bump one rung on failure, cap `maxAttempts`.
- Audit via `ctx.storage`. Keeps single-response effort fixed (observable/reproducible).

**Option C — Hybrid: heuristic fast-path + LLM classifier on low confidence**
- If score confidence `<floor`, call `ctx.session.generate` / `ctx.generate.text` with tiny model to classify (complexity/taskType/risk) then apply. Cache in storage.
- Cost: ~100ms only on ambiguous prompts. Needs default classifier model ID — prefer local/fast; make opt-out via options.

**Option D — Self-selection via system prompt (no router code)**
- `context` hook injects: “Choose NoThink/Short/Long first; respect caps; prefer brief on trivial” + `options` caps. Model emits mode token.
- Zero classifier code, but non-deterministic, needs capable model, collapse/verbosity risks. Good as fallback when provider supports thinking modes natively.

**Option E — Provider-native mapping only**
- Map heuristic directly to `reasoningEffort: minimal|low|medium|high|xhigh` (OpenAI Responses) / `thinking` per tier. Keep model fixed (effort routing ≠ model routing — comparable/reproducible). Document per-task defaults + `/reasoning` override command.
- Note V2 limitation surfaced by adapters: per-prompt model override / TUI default agent not guaranteed — routing **effort** via `options` is safer than swapping models mid-flight.

Suggested minimal-config stack: **A+B default, C opt-in, E mapping, D alternative**. Surface chosen effort in footer/logs (`auto→high`) and keep explicit `/reasoning <level|auto>` + `pin`/`fix` as hard override.

## 4. Key URLs
- V2 plugins/transforms/hooks (prompt/context/provider-options/model.request/http/retry/session ref): https://opencode.ai/v2/docs/build/plugins
- V2 Effect plugins (transform/reload semantics): https://opencode.ai/v2/docs/build/plugins/effect
- V1→V2 migration table (chat.params→context, system.transform→context, tool hooks): https://opencode.ai/v2/docs/build/plugins/migrate-v1
- V2 plugins loading/options: https://opencode.ai/v2/docs/plugins/
- V2 agents (modes, system, permissions, request overlays not yet sent): https://opencode.ai/v2/docs/agents
- V2 instructions (AGENTS.md loading; `instructions[]` not resolved): https://opencode.ai/v2/docs/instructions and https://opencode.ai/v2/docs/config
- V2↔V1 adapter + constraints (context hook bridging, no per-prompt model override): https://github.com/alvinunreal/oh-my-opencode-slim/blob/master/docs/opencode-v2-compatibility.md
- Deterministic effort router + escalation + audit (model-fixed): https://github.com/luckeyfaraday/auto-reasoning
- Per-turn heuristic + LLM classifier + budget + phase memory + thinking control: https://github.com/yeliu84/pi-model-router/
- Smart reasoning_effort routing request (rules vs LLM auto-classify, `auto` + `/reasoning` override): https://github.com/NousResearch/hermes-agent/issues/13663
- Ares per-step router (52.7% saving, random/fixed-low fail): https://arxiv.org/html/2603.07915
- Self-routing NoThink/Short/Long in GRPO (41% shorter, 76% GSM8K): https://www.alphaxiv.org/abs/2608.20256 and https://arxiv.org/html/2608.20256v2
- Route-To-Reason joint model+strategy (60%+ cut): https://arxiv.org/html/2505.19435
- Task-aware budget / overthinking + classifier sketch: https://blog.gentrit.dev/posts/task-aware-reasoning-allocation
- CDR fast/slow routing (34% cut, 4 dims): https://arxiv.org/html/2508.16636
- AutoThink adaptive budgets + steering: https://huggingface.co/blog/codelion/autothink
- Budget guidance / RPO root-token routing: https://aclanthology.org/2026.findings-acl.1866.pdf and https://exa.ai/library/publication/xw39j668m3g
- Ranking reasoning router (model-aware + Pareto policy): https://arxiv.org/html/2601.18146v1
- Node-adaptive GoT routing: https://arxiv.org/html/2603.05818

*Searches used: 5/5 (v2 hooks/agents/config, adaptive routing, transforms, effort auto-select). Fetched: v2 plugins overview for exact hook/transform signatures.*
