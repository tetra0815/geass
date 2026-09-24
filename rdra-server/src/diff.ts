import { canonicalize } from "./model/hash.js";
import { KINDS, type AnyElement, type KindKey, type Model } from "./model/kinds.js";

export type ChangeType = "added" | "removed" | "modified";

export interface ElementChange {
  id: string;
  kind: KindKey;
  type: ChangeType;
  fields: string[];
  before?: AnyElement;
  after?: AnyElement;
}

export function diffModels(base: Model, head: Model): ElementChange[] {
  const changes: ElementChange[] = [];
  for (const kind of KINDS) {
    const before = new Map((base[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    const after = new Map((head[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    for (const [id, next] of after) {
      const prev = before.get(id);
      if (!prev) {
        changes.push({ id, kind: kind.key, type: "added", fields: [], after: next });
        continue;
      }
      const a = canonicalize(prev) as Record<string, unknown>;
      const b = canonicalize(next) as Record<string, unknown>;
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]))
        .sort();
      if (fields.length > 0) changes.push({ id, kind: kind.key, type: "modified", fields, before: prev, after: next });
    }
    for (const [id, prev] of before) {
      if (!after.has(id)) changes.push({ id, kind: kind.key, type: "removed", fields: [], before: prev });
    }
  }
  return changes;
}
