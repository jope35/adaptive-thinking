// tests/variants.test.ts
import { describe, expect, it } from "vitest";
import { pruneStale, resolveValidLevels, VariantStore } from "../src/variants.js";

const models = [
  { providerID: "openai", id: "gpt-5", variants: [{ id: "low" }, { id: "high" }] },
  { providerID: "anthropic", id: "sonnet", variants: [{ id: "low" }, { id: "max" }] },
];

describe("resolveValidLevels", () => {
  it("returns ids for the current model only", () => {
    expect(resolveValidLevels(models, "openai", "gpt-5")).toEqual(["low", "high"]);
  });

  it("returns empty when model unknown", () => {
    expect(resolveValidLevels(models, "openai", "nope")).toEqual([]);
  });

  it("returns empty when variants missing", () => {
    expect(resolveValidLevels([{ providerID: "x", id: "y" }], "x", "y")).toEqual([]);
  });
});

describe("VariantStore", () => {
  it("stores sticky levels and prunes stale on model switch", () => {
    const store = new VariantStore(2);
    store.set("s1", "high");
    expect(store.get("s1")).toBe("high");
    pruneStale(store, "s1", ["low"]);
    expect(store.get("s1")).toBeUndefined();
  });

  it("evicts oldest beyond cap", () => {
    const store = new VariantStore(2);
    store.set("a", "low");
    store.set("b", "low");
    store.set("c", "low");
    expect(store.get("a")).toBeUndefined();
    expect(store.get("c")).toBe("low");
  });
});
