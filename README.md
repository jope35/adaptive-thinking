# @<scope>/opencode-adaptive-thinking

Let the model pick its own reasoning level (OpenCode v2).

## Install

```jsonc
{ "plugins": ["@<scope>/opencode-adaptive-thinking"] }
```

```sh
opencode plugin add @<scope>/opencode-adaptive-thinking
```

## Options (all optional)

```jsonc
{ "plugins": [{ "package": "@<scope>/opencode-adaptive-thinking", "options": {
  "enabled": true,
  "quiet": false,
  "toolName": "set_reasoning_effort",
  "toolDescription": "Set your reasoning effort",
  "systemPrompt": "…"
} }] }
```

## Behavior

- System prompt lists only the current model's valid levels; agent calls the tool to switch.
- Switches are sticky until the next switch; model change clears stale levels.
- No valid levels → tool reports failure; prompt injection continues without the Valid list.

## Troubleshooting

- `no valid … levels` → active model/provider exposes no variants.
- `Invalid … level` → use a level from the system prompt list.
- `reasoningEffort` is OpenAI-side; Anthropic thinking models use `thinking.budgetTokens` — set effort on the matching provider model.
- Restart TUI / use a fresh session after config changes.
