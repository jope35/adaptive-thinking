# Research Plan: Adaptive Thinking Plugin for OpenCode v2

Main question: How to build an OpenCode v2 plugin with minimal user configuration that lets agents pick the best reasoning mode per task?

## Subtopics

1. opencode_v2_plugins - How plugin development works in v2 (entrypoints, hooks, tools, transforms, config, install). Expected: file layout, API, examples.
2. adaptive_thinking_repo - What ian-pascoe/opencode-adaptive-thinking does (modes, triggers, prompts). Expected: mode list and selection logic.
3. reasoning_modes - What tokenminning.ai reasoning page and openreview paper say about reasoning modes and configs that fail. Expected: mode taxonomy and pitfalls.
4. minimal_config_design - How to make zero-config mode selection work (heuristics, hooks vs tools). Expected: design options.

Synthesis: combine into plugin spec with file layout and selection logic.
