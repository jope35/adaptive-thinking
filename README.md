# Adaptive-Thinking

[![npm version](https://img.shields.io/npm/v/adaptive-thinking.svg)](https://www.npmjs.com/package/adaptive-thinking) [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE) [![Node](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![OpenCode](https://img.shields.io/badge/OpenCode-2.x-blue.svg)](https://opencode.ai)

OpenCode plugin. The model picks its own reasoning level per turn.

## Contents

- [Contents](#contents)
- [Install](#install)
- [Verify your install](#verify-your-install)
- [Configuration](#configuration)
- [Examples](#examples)
- [How it works](#how-it-works)
- [What it does](#what-it-does)
- [Limits](#limits)
- [Credits](#credits)

Requires OpenCode 2.x (tested on 2.0.19).

## Install

```
{
  "$schema": "https://opencode.ai/config.json",
  "plugins": ["adaptive-thinking"]
}
```

Restart OpenCode after install. Restart picks up config changes.

## Verify your install

Run a headless session in a scratch project and read the transcript:

```
mkdir -p /tmp/at-verify/proj /tmp/at-verify/cfg/opencode/plugins
cd /tmp/at-verify/proj
echo 'export { default } from "<checkout>/src/index.ts";' > /tmp/at-verify/cfg/opencode/plugins/adaptive-thinking.ts
XDG_CONFIG_HOME=/tmp/at-verify/cfg opencode run --standalone -m <provider>/<model> "Summarize this repo in one line"
```

Use the single-file form above: directory entries in the `plugins` configuration were silently ignored in testing. The check passes when the transcript shows the Valid levels sentence and the model calls `set_reasoning_effort` on its own. This uses no model beyond the run itself.

## Configuration

Every option is optional.

With options (object form):

```
{
  "plugins": [
    { "package": "adaptive-thinking", "options": { "toolName": "set_reasoning_effort" } }
  ]
}
```

| Option | Default | Rule |
| --- | --- | --- |
| `enabled` | `true` | `false` disables the plugin without uninstalling. |
| `quiet` | `false` | Reserved for future toast suppression; config errors always log. |
| `toolName` | `set_reasoning_effort` | Non-empty string. |
| `toolDescription` | `Set your reasoning effort` | Non-empty string. |
| `systemPrompt` | built-in adaptive guidance | Non-empty string. |

## Examples

1. Defaults only:

```
{
  "plugins": ["adaptive-thinking"]
}
```

2. Custom tool name only:

```
{
  "plugins": [{ "package": "adaptive-thinking", "options": { "toolName": "set_effort" } }]
}
```

3. Everything set:

```
{
  "plugins": [
    {
      "package": "adaptive-thinking",
      "options": {
        "enabled": true,
        "quiet": false,
        "toolName": "set_reasoning_effort",
        "toolDescription": "Set your reasoning effort",
        "systemPrompt": "…"
      }
    }
  ]
}
```

## How it works

```
flowchart LR
    agent["Agent"]
    tool["set_reasoning_effort tool"]
    store[("Sticky level per session")]
    hook["context hook"]

    agent -- "reassess each turn" --> tool
    tool -- "validate vs model variants" --> store
    hook -- "inject guidance + valid levels" --> agent
    hook -- "apply stored level via options.reasoningEffort" --> agent
```

Loading

## What it does

- Registers `set_reasoning_effort` (name configurable) through `ctx.tool.transform`.

- Injects adaptive guidance plus the current level and the session's valid levels through `ctx.session.hook("context")`. Valid levels come from the current model's variants at runtime; nothing is hardcoded.

- Applies the stored level via `event.options.reasoningEffort` on every dispatch. Switches are sticky until the next switch; a model change clears a stale level.

- Fails closed: unknown model or no variants means the tool reports failure and the prompt ships without the Valid list.

## Limits

- The active model must expose reasoning-effort variants, or there is nothing to switch (`no valid … levels`).

- `Invalid … level` means the model picked a level outside the listed ones; it must use a level from the system prompt list.

- `reasoningEffort` is OpenAI-side; Anthropic thinking models use `thinking.budgetTokens`. Set effort on the matching provider model.

- Typo'd model IDs silently fall back to no valid levels.

- Restart TUI / use a fresh session after config changes.

- Downshifting relies on the model following the guidance; a sticky high level persists until it switches back.

## Credits

Idea adapted from [ian-pascoe/opencode-adaptive-thinking](https://github.com/ian-pascoe/opencode-adaptive-thinking).
