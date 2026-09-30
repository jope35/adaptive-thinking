# adaptive-thinking

Let the model pick its own reasoning level (OpenCode v2).

## Install

```jsonc
{ "plugins": ["adaptive-thinking"] }
```

```sh
opencode plugin add adaptive-thinking
```

## Options (all optional)

```jsonc
{ "plugins": [{ "package": "adaptive-thinking", "options": {
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
- Typo'd model IDs silently fall back to no valid levels.

## Verify locally

```sh
mkdir -p /tmp/at-verify/proj /tmp/at-verify/cfg/opencode/plugins
cd /tmp/at-verify/proj
echo 'export { default } from "<checkout>/src/index.ts";' > /tmp/at-verify/cfg/opencode/plugins/adaptive-thinking.ts
XDG_CONFIG_HOME=/tmp/at-verify/cfg opencode run --standalone -m <provider>/<model> "Summarize this repo in one line"
```

Use the single-file form above: directory entries in the `plugins` configuration were silently ignored in testing. The check passes when the transcript shows the Valid levels sentence and the model calls `set_reasoning_effort` on its own.

## Credits

Idea adapted from [ian-pascoe/opencode-adaptive-thinking](https://github.com/ian-pascoe/opencode-adaptive-thinking).
