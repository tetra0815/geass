import { canonicalize } from "./model/hash.js";
import { KINDS, type AnyElement, type KindKey, type Model, type Usecase } from "./model/kinds.js";

export type ChangeType = "added" | "removed" | "modified";

export interface AcceptanceChange {
  id: string;
  type: ChangeType;
}

export interface ElementChange {
  id: string;
  kind: KindKey;
  type: ChangeType;
  fields: string[];
  before?: AnyElement;
  after?: AnyElement;
  acceptance?: AcceptanceChange[];
}

function acceptanceChanges(before: Usecase | undefined, after: Usecase | undefined): AcceptanceChange[] {
  const prev = new Map((before?.acceptance ?? []).map((a) => [a.id, a]));
  const next = new Map((after?.acceptance ?? []).map((a) => [a.id, a]));
  const out: AcceptanceChange[] = [];
  for (const id of [...new Set([...prev.keys(), ...next.keys()])].sort()) {
    const a = prev.get(id);
    const b = next.get(id);
    if (!a) out.push({ id, type: "added" });
    else if (!b) out.push({ id, type: "removed" });
    else if (JSON.stringify(canonicalize(a)) !== JSON.stringify(canonicalize(b))) out.push({ id, type: "modified" });
  }
  return out;
}

function withAcceptance(change: ElementChange): ElementChange {
  if (change.kind !== "usecases") return change;
  const acceptance = acceptanceChanges(change.before as Usecase | undefined, change.after as Usecase | undefined);
  return acceptance.length > 0 ? { ...change, acceptance } : change;
}

export function diffModels(base: Model, head: Model): ElementChange[] {
  const changes: ElementChange[] = [];
  for (const kind of KINDS) {
    const before = new Map((base[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    const after = new Map((head[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    for (const [id, next] of after) {
      const prev = before.get(id);
      if (!prev) {
        changes.push(withAcceptance({ id, kind: kind.key, type: "added", fields: [], after: next }));
        continue;
      }
      const a = canonicalize(prev) as Record<string, unknown>;
      const b = canonicalize(next) as Record<string, unknown>;
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]))
        .sort();
      if (fields.length > 0) changes.push(withAcceptance({ id, kind: kind.key, type: "modified", fields, before: prev, after: next }));
    }
    for (const [id, prev] of before) {
      if (!after.has(id)) changes.push(withAcceptance({ id, kind: kind.key, type: "removed", fields: [], before: prev }));
    }
  }
  return changes;
}
