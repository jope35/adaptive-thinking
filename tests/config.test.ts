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
