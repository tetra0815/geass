import type { ElementChange } from "../../src/diff.js";
import { KINDS, emptyModel, kindOfId, type AnyElement, type Model } from "../../src/model/kinds.js";
import { parseTransitionRef, relationsOf, type Relation, type RelationKind } from "../../src/model/relations.js";
import type { ViewKey } from "../../src/model/view-keys.js";

export type ChangeStatus = "added" | "modified" | "removed";

export interface DiagramNode {
  id: string;
  type: string;
  label: string;
  elementId: string;
  parent?: string;
  status?: ChangeStatus;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation?: RelationKind;
  from?: string;
  to?: string;
  status?: "added" | "removed";
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const VIEW_PREFIXES: Record<ViewKey, readonly string[]> = {
  "system-context": ["act", "ext"],
  "business-flow": ["buc", "act", "uc"],
  "usecase-composite": ["uc", "act", "scr", "evt", "inf", "ext", "st"],
  "information-model": ["inf"],
  "state-model": [],
};

const VIEW_RELATIONS: Record<ViewKey, readonly RelationKind[]> = {
  "system-context": [],
  "business-flow": ["buc.actor", "buc.usecase"],
  "usecase-composite": ["uc.actor", "uc.screen", "uc.event", "uc.information", "uc.transition", "evt.source", "evt.target"],
  "information-model": ["inf.related"],
  "state-model": [],
};

export const SYSTEM_NODE_ID = "system";

export function viewForId(id: string): ViewKey {
  const prefix = id.split(/[.:]/, 1)[0];
  if (prefix === "act" || prefix === "ext") return "system-context";
  if (prefix === "buc") return "business-flow";
  if (prefix === "inf") return "information-model";
  if (prefix === "st") return "state-model";
  return "usecase-composite";
}

export function stateNodeId(modelId: string, stateId: string): string {
  return `${modelId}:${stateId}`;
}

function single(element: AnyElement): Model {
  const model = emptyModel();
  const kind = kindOfId(element.id);
  if (kind) (model[kind.key] as AnyElement[]).push(element);
  return model;
}

const relationKey = (r: Relation) => `${r.kind}|${r.from}|${r.to}`;

function edgeFor(r: Relation, status?: "added" | "removed"): DiagramEdge {
  const base = { id: relationKey(r), source: r.from, target: r.to, relation: r.kind, from: r.from, to: r.to, status };
  if (r.kind === "uc.transition") {
    const t = parseTransitionRef(r.to);
    return { ...base, target: t ? t.model : r.to, label: t ? `${t.from}→${t.to}` : r.to };
  }
  if (r.kind === "uc.information") return { ...base, label: r.attrs.access };
  if (r.kind === "inf.related") return { ...base, label: r.attrs.label };
  return base;
}

function projectElements(view: ViewKey, model: Model, changes: ElementChange[]): Diagram {
  const prefixes = VIEW_PREFIXES[view];
  const statusOf = new Map(changes.map((c) => [c.id, c.type]));
  const nodes: DiagramNode[] = [];
  for (const kind of KINDS) {
    if (!prefixes.includes(kind.prefix)) continue;
    for (const e of model[kind.key] as AnyElement[]) {
      nodes.push({ id: e.id, type: kind.prefix, label: e.name, elementId: e.id, status: statusOf.get(e.id) });
    }
  }
  for (const c of changes) {
    if (c.type === "removed" && c.before && prefixes.includes(c.id.split(".")[0])) {
      nodes.push({ id: c.id, type: c.id.split(".")[0], label: c.before.name, elementId: c.id, status: "removed" });
    }
  }

  const allowed = new Set(VIEW_RELATIONS[view]);
  const current = relationsOf(model).filter((r) => allowed.has(r.kind));
  const currentKeys = new Set(current.map(relationKey));
  const addedKeys = new Set<string>();
  const removed: Relation[] = [];
  for (const c of changes) {
    const before = c.before ? relationsOf(single(c.before)).filter((r) => allowed.has(r.kind)) : [];
    const after = c.after ? relationsOf(single(c.after)).filter((r) => allowed.has(r.kind)) : [];
    const beforeKeys = new Set(before.map(relationKey));
    for (const r of after) if (!beforeKeys.has(relationKey(r))) addedKeys.add(relationKey(r));
    for (const r of before) if (!currentKeys.has(relationKey(r))) removed.push(r);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [
    ...current.map((r) => edgeFor(r, addedKeys.has(relationKey(r)) ? "added" : undefined)),
    ...removed.map((r) => edgeFor(r, "removed")),
  ].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  if (view === "system-context") {
    nodes.push({ id: SYSTEM_NODE_ID, type: "system", label: "システム", elementId: SYSTEM_NODE_ID });
    for (const n of nodes) {
      if (n.type === "act" || n.type === "ext") {
        const events = model.events.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.name);
        edges.push({ id: `ctx|${n.id}`, source: n.id, target: SYSTEM_NODE_ID, label: events.join("、") || undefined });
      }
    }
  }
  return { nodes, edges };
}

function projectStates(model: Model, changes: ElementChange[]): Diagram {
  const statusOf = new Map(changes.map((c) => [c.id, c.type]));
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const sm of model.states) {
    nodes.push({ id: sm.id, type: "st", label: sm.name, elementId: sm.id, status: statusOf.get(sm.id) });
    for (const s of sm.states) {
      nodes.push({ id: stateNodeId(sm.id, s.id), type: "state", label: s.name, elementId: sm.id, parent: sm.id });
    }
    for (const t of sm.transitions) {
      const ref = `${sm.id}:${t.from}->${t.to}`;
      const causes = model.usecases.filter((u) => u.transitions.includes(ref)).map((u) => u.name);
      edges.push({
        id: `tr|${ref}`,
        source: stateNodeId(sm.id, t.from),
        target: stateNodeId(sm.id, t.to),
        label: causes.join("、") || undefined,
        from: sm.id,
        to: ref,
      });
    }
  }
  return { nodes, edges };
}

export function projectView(view: ViewKey, model: Model, changes: ElementChange[] = []): Diagram {
  return view === "state-model" ? projectStates(model, changes) : projectElements(view, model, changes);
}
