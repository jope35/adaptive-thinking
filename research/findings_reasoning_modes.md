# Reasoning Modes for Coding Agents — Findings

Sources:
- https://tokenminning.ai/ides/opencode/reasoning (fetched 2026-09-27; verified against OpenCode Models + CLI docs, Aug 2026; page last updated 2026-06-24)
- https://openreview.net/pdf?id=2i6Rp0gCq6 — Li et al., "Adaptive Thinking: LLMs Know When to Think in Latent Space" (ICLR 2026 Poster; Apple + UNC; fetched via Exa due to OpenReview bot-check) + forum page https://openreview.net/forum?id=2i6Rp0gCq6 (published 2025-10-08)
- Supplemental: https://platform.claude.com/docs/en/build-with-claude/effort (Claude effort-level guidance, retrieved via search)

## 1. Mode taxonomy: fast vs deep vs adaptive

### OpenCode / provider-level controls (tokenminning.ai)
No single global "reasoning effort" knob. Effort is set per model under `provider.<id>.models.<model-id>.options`, optionally overridden per agent under `agent.<name>.options` (agent wins), or one-off via `opencode run --variant <name>`. Precedence: global `model` default → provider model `options` → per-agent `model` + `options` → CLI `--variant`.

| Mode | OpenAI / OpenAI-compatible | Anthropic | Google | Effect |
|---|---|---|---|---|
| Fast (minimal thinking) | `reasoningEffort: "none"` / `"minimal"` / `"low"`; or non-thinking model ID | smallest `budgetTokens`; or non-thinking model ID (e.g. Haiku for Plan); variant `low` | variant `low` | Cheapest, lowest latency; for grep-style Q&A, plan review, subagents, chat |
| Balanced | `reasoningEffort: "medium"` | mid `budgetTokens` (~8000 in example) | — | Multi-file refactor, routine agentic coding |
| Deep | `reasoningEffort: "high"` / `"xhigh"`; variant `high` | large `budgetTokens` (e.g. 16000); variants `high` (default on many thinking models) / `max` | variant `high` | Novel architecture, deep debug, long-horizon agentic work |
| Adaptive (task-based) | Not a value — achieved by splitting Plan (cheap model/low effort) vs Build (capable model/higher effort) + `variant_cycle` keybind / `--variant` per invocation | Same pattern: `agent.plan.model → Haiku` (no thinking), `agent.build.model → Sonnet thinking variant` | Same pattern | Pay thinking overhead only where it pays off |

Claude platform docs mirror this taxonomy with a unified `effort` parameter (`low` / `medium` / `high` / `xhigh` / `max`; default `high`): "effort is a behavioral signal, not a strict token budget. At lower effort levels, Claude still thinks on sufficiently difficult problems, but thinks less." Recommended: start `high` (default); `xhigh`/`max` for hardest coding/agentic work; `medium`/`low` for routine, latency-sensitive, or subagent work after evals confirm quality holds. `max` on most workloads "adds significant cost for relatively small quality gains, and on some structured-output tasks it can lead to overthinking."

### Research-level adaptive mode: Sonata (Li et al., ICLR 2026)
- Proxy for thinking necessity = **self-consistency** (agreement among multiple sampled reasoning paths). Lower self-consistency → query needs extended thinking (Fig. 1: MATH-500 difficulty 1→5 self-consistency falls 0.795 → 0.517 on Qwen3-8B).
- **Sonata** (Self-Consistency-Guided Adapter for Thinking Allocation): lightweight adapter trained offline on a calibration set to predict self-consistency from **last-layer hidden states at prefill time**, then allocates thinking budget on the fly before decoding.
- Overhead < 1‰ (<0.1%) at inference; transferable across tasks without retraining; compatible with existing CoT compression methods (RL brevity, early-exit, terminator tokens).
- Result: **20–60% fewer thinking tokens at same accuracy, or up to +2% accuracy at same token cost**, across Qwen3-8B/32B, GPT-OSS-120B, Qwen3-235B-A22B × AIME25, GSM8K, MATH500, GPQA, LiveCodeBench.

## 2. Which configs work vs fail and why

Works (tokenminning.ai, verified vs OpenCode docs):
- `provider.openai.models.gpt-5.options = {reasoningEffort: "high", textVerbosity: "low", reasoningSummary: "auto"}`.
- `provider.anthropic.models.<sonnet-id>.options = {thinking: {type: "enabled", budgetTokens: 8000–16000}}`.
- Per-agent split: `agent.plan.model = anthropic/claude-haiku-4-5` (cheap), `agent.build.model = anthropic/claude-sonnet-4-5` + `options.reasoningEffort: "medium"`.
- One-off: `opencode run --variant low "Summarize this diff"`; `opencode run -m openai/gpt-5 --variant high "Design the migration plan"`.
- `tokenmin opencode` launcher to skip flags; `opencode models <provider>` / `--refresh` / `--verbose` to confirm exact model strings; restart TUI / fresh session to pick up config.
- Custom variants under `provider.<id>.models.<model>.variants` to bundle options.

Fails and why:
| Mistake | Why it fails |
|---|---|
| `reasoningEffort` on an Anthropic thinking model | Wrong schema — Anthropic expects `thinking.budgetTokens` |
| `budgetTokens` on OpenAI GPT-5 | Wrong schema — OpenAI expects `reasoningEffort` |
| Options on a mistyped model ID | Keys apply per `models.<id>`; typo = silent provider default |
| Global `model` only, no agent split | Plan and Build both inherit (expensive) thinking defaults |
| Expecting `--variant` without variant definitions | Falls back; variant must exist on that model/provider |
| Custom/OpenRouter gateway keys the server ignores | Gateway strips unknown fields; effort unchanged |
| Editing config without restarting long TUI session | Old sessions keep old config; verify with fresh `opencode run` |
| Wrong schema version (stable vs v2 docs) | Silent defaults; validate against `https://opencode.ai/v2/docs/models` if on v2 |
| Using a thinking model for every parallel subagent (`@general`/`@scout`/Task) | Multiplies thinking overhead fast; prefer read-only `@explore`, restrict with `permission.task` |

## 3. Evidence for task-based mode selection

- Tokenminning task→effort table: grep-style/plan-review → Haiku, no thinking; multi-file refactor → capable model, moderate effort; novel architecture/deep debug → thinking variant, scoped prompt. Rule: "Use Plan with cheap models; raise effort only on Build after you approve the approach." Picking Haiku for Plan beats forcing low thinking on a Sonnet thinking variant.
- Claude `effort` docs: "Consider dynamic effort: simple queries → low; agentic coding and complex reasoning → high." But vary deliberately and re-sweep evals per model — don't carry settings across models. `low` + explicit checklists for multi-section tasks (Opus 4.7 guidance).
- Sonata paper: fixed budgets are compute-suboptimal — excessive thinking wastes resources on simple queries and "may even hurt performance" (cites Li et al. 2025c; Hassid et al. 2025; Wu et al. 2025b; Hou et al. 2025), while insufficient thinking fails complex ones. Self-consistency predicted from prefill hidden states is a cheap, generalizable router signal; latent representations of different-difficulty queries are "highly distinguishable." Entropy proxies fail (don't capture intrinsic difficulty); online-computation routers cost too much.
- Implication for adaptive-thinking experiments: a prefill-time difficulty/confidence signal (Sonata-style adapter, or even a cheap classifier/plan-pass) routing to fast vs deep modes should recover most of the 20–60% token saving without accuracy loss — matches the Plan-cheap/Build-deep pattern already recommended in OpenCode practice.
