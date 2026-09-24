import { emptyModel, findElement, kindDef, type AnyElement, type KindKey, type Model } from "./model/kinds.js";
import {
  RELATION_FIELDS,
  elementFields,
  parseTransitionRef,
  relationSourcePrefix,
  relationsOf,
  type Relation,
  type RelationKind,
} from "./model/relations.js";

export type Operation =
  | { op: "upsert"; kind: KindKey; element: Record<string, unknown> }
  | { op: "delete"; id: string }
  | { op: "link"; relation: RelationKind; from: string; to: string; attrs?: Record<string, string> }
  | { op: "unlink"; relation: RelationKind; from: string; to: string };

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

function formatIssues(id: string, issues: { path: PropertyKey[]; message: string }[]): string {
  return `${id}: ${issues.map((i) => `${i.path.map(String).join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

function reparse(model: Model, id: string): void {
  const found = findElement(model, id);
  if (!found) throw new OperationError(`${id} は存在しません`);
  const result = found.kind.schema.safeParse(found.element);
  if (!result.success) throw new OperationError(formatIssues(id, result.error.issues));
  (model[found.kind.key] as AnyElement[])[found.index] = result.data as AnyElement;
}

function upsert(model: Model, key: KindKey, patch: Record<string, unknown>): void {
  const id = patch.id;
  if (typeof id !== "string" || id === "") throw new OperationError("upsert には id が必要です");
  const def = kindDef(key);
  const list = model[key] as AnyElement[];
  const index = list.findIndex((e) => e.id === id);
  const merged = index >= 0 ? { ...list[index], ...patch } : patch;
  const result = def.schema.safeParse(merged);
  if (!result.success) throw new OperationError(formatIssues(id, result.error.issues));
  if (index >= 0) list[index] = result.data as AnyElement;
  else list.push(result.data as AnyElement);
}

function detach(model: Model, relation: RelationKind, from: string, to: string): boolean {
  const found = findElement(model, from);
  if (!found) return false;
  const fields = elementFields(found.element);
  const { field, shape } = RELATION_FIELDS[relation];
  if (shape === "ids") {
    const list = fields[field] as string[];
    const index = list.indexOf(to);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }
  if (shape === "refs") {
    const list = fields[field] as { ref: string }[];
    const index = list.findIndex((x) => x.ref === to);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }
  if (fields[field] !== to) return false;
  delete fields[field];
  return true;
}

function pointsAt(r: Relation, id: string): boolean {
  if (r.to === id) return true;
  return r.kind === "uc.transition" && parseTransitionRef(r.to)?.model === id;
}

function remove(model: Model, id: string): Relation[] {
  const found = findElement(model, id);
  if (!found) throw new OperationError(`${id} は存在しません`);
  const single = emptyModel();
  (single[found.kind.key] as AnyElement[]).push(found.element);
  const outgoing = relationsOf(single);
  (model[found.kind.key] as AnyElement[]).splice(found.index, 1);
  const incoming = relationsOf(model).filter((r) => pointsAt(r, id));
  for (const r of incoming) detach(model, r.kind, r.from, r.to);
  return [...outgoing, ...incoming];
}

function link(model: Model, relation: RelationKind, from: string, to: string, attrs: Record<string, string> = {}): void {
  const prefix = relationSourcePrefix(relation);
  if (!from.startsWith(`${prefix}.`)) throw new OperationError(`${relation} の起点は ${prefix}.* である必要があります（指定: ${from}）`);
  const found = findElement(model, from);
  if (!found) throw new OperationError(`${from} は存在しません`);
  const fields = elementFields(found.element);
  const { field, shape } = RELATION_FIELDS[relation];
  if (shape === "ids") {
    const list = fields[field] as string[];
    if (!list.includes(to)) list.push(to);
  } else if (shape === "refs") {
    const list = fields[field] as Record<string, unknown>[];
    const existing = list.find((x) => x.ref === to);
    if (existing) Object.assign(existing, attrs);
    else list.push({ ref: to, ...attrs });
  } else {
    fields[field] = to;
  }
  reparse(model, from);
}

export function applyOperations(input: Model, ops: Operation[]): { model: Model; removedRelations: Relation[] } {
  const model = structuredClone(input);
  const removedRelations: Relation[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "upsert":
        upsert(model, op.kind, op.element);
        break;
      case "delete":
        removedRelations.push(...remove(model, op.id));
        break;
      case "link":
        link(model, op.relation, op.from, op.to, op.attrs);
        break;
      case "unlink":
        if (!detach(model, op.relation, op.from, op.to)) {
          throw new OperationError(`${op.from} から ${op.to} への ${op.relation} は存在しません`);
        }
        break;
    }
  }
  return { model, removedRelations };
}
