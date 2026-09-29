// src/variants.ts
export type ModelRow = {
  providerID: string;
  id?: string;
  modelID?: string;
  variants?: Array<{ id: string }>;
};

export class VariantStore {
  private map = new Map<string, string>();
  constructor(private cap = 500) {}

  get(sessionID: string): string | undefined {
    return this.map.get(sessionID);
  }

  set(sessionID: string, level: string): void {
    if (this.map.has(sessionID)) this.map.delete(sessionID);
    this.map.set(sessionID, level);
    while (this.map.size > this.cap) {
      const oldest = this.map.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  delete(sessionID: string): void {
    this.map.delete(sessionID);
  }

  clear(): void {
    this.map.clear();
  }
}

/**
 * Normalize the model list. The live server resolves `ctx.model.list()` to
 * `{ location, data: ModelRow[] }`; accept a bare array too (mocks, older
 * shapes). Anything else yields no rows instead of throwing.
 */
function toRows(models: unknown): ModelRow[] {
  if (Array.isArray(models)) return models as ModelRow[];
  if (models !== null && typeof models === "object" && Array.isArray((models as { data?: unknown }).data)) {
    return (models as { data: ModelRow[] }).data;
  }
  return [];
}

export function resolveValidLevels(
  models: unknown,
  providerID: string | undefined,
  modelID: string | undefined,
): string[] {
  if (!providerID || !modelID) return [];
  const found = toRows(models).find((m) => m.providerID === providerID && (m.id ?? m.modelID) === modelID);
  if (!found || !Array.isArray(found.variants)) return [];
  return found.variants.map((v) => v.id).filter((id) => typeof id === "string" && id.length > 0);
}

export function pruneStale(store: VariantStore, sessionID: string, valid: string[]): void {
  const current = store.get(sessionID);
  if (current !== undefined && !valid.includes(current)) store.delete(sessionID);
}
