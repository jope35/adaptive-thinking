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

  it("unwraps the live { location, data } envelope", () => {
    expect(resolveValidLevels({ location: { directory: "/tmp/x" }, data: models }, "openai", "gpt-5")).toEqual([
      "low",
      "high",
    ]);
  });

  it("matches modelID when id is absent", () => {
    const rows = [{ providerID: "openai", modelID: "gpt-5", variants: [{ id: "low" }] }];
    expect(resolveValidLevels({ data: rows }, "openai", "gpt-5")).toEqual(["low"]);
  });

  it("returns empty for non-list input instead of throwing", () => {
    expect(resolveValidLevels(undefined, "openai", "gpt-5")).toEqual([]);
    expect(resolveValidLevels({}, "openai", "gpt-5")).toEqual([]);
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
