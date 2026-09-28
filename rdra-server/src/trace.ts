import type { ElementChange } from "./diff.js";
import { KINDS, acceptanceRef, type AnyElement, type KindKey, type Model, type Principle } from "./model/kinds.js";

export interface TraceTargets {
  required: string[];
  applicable: string[];
}

export interface TraceReport {
  ok: boolean;
  required: string[];
  applicable: string[];
  covered: string[];
  uncovered: string[];
  unknown: string[];
  outOfScope: string[];
}

// Process and stack rules apply to every feature; tying them to individual
// tasks would only produce a "Covers: pr.tdd" line on every task.
const NOT_TRACED: readonly Principle["category"][] = ["engineering", "technology"];

function liveChanges(changes: ElementChange[], kind: KindKey): Set<string> {
  return new Set(changes.filter((c) => c.kind === kind && c.type !== "removed").map((c) => c.id));
}

export function traceTargets(model: Model, changes: ElementChange[]): TraceTargets {
  const usecases = liveChanges(changes, "usecases");
  const principles = liveChanges(changes, "principles");
  const required = new Set<string>();
  const applicable = new Set<string>();
  for (const uc of model.usecases) {
    if (!usecases.has(uc.id)) continue;
    for (const ac of uc.acceptance) required.add(acceptanceRef(uc.id, ac.id));
  }
  for (const p of model.principles) {
    if (p.level !== "must") continue;
    if (p.scope.length === 0 && NOT_TRACED.includes(p.category)) {
      applicable.add(p.id);
      continue;
    }
    if (principles.has(p.id) || p.scope.some((id) => usecases.has(id))) required.add(p.id);
  }
  return { required: [...required].sort(), applicable: [...applicable].sort() };
}

export function knownRefs(model: Model): Set<string> {
  const known = new Set<string>();
  for (const kind of KINDS) for (const e of model[kind.key] as AnyElement[]) known.add(e.id);
  for (const uc of model.usecases) for (const ac of uc.acceptance) known.add(acceptanceRef(uc.id, ac.id));
  return known;
}

const COVERS_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?Covers(?:\*\*)?:(?:\*\*)?\s*(.*)$/;
const FENCE = /^\s*(`{3,}|~{3,})(.*)$/;

export function parseCovers(markdown: string): string[] {
  const refs: string[] = [];
  // The open fence, if any. As in CommonMark, only a run of the same
  // character at least as long, with nothing after it, closes it.
  let fence: string | null = null;
  for (const line of markdown.split(/\r?\n/)) {
    const f = FENCE.exec(line);
    if (fence) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !f[2].trim()) fence = null;
      continue;
    }
    if (f && !(f[1][0] === "`" && f[2].includes("`"))) {
      fence = f[1];
      continue;
    }
    const m = COVERS_LINE.exec(line);
    if (!m) continue;
    for (const token of m[1].split(/[\s,、]+/)) {
      const ref = token.replace(/^[`*]+/, "").replace(/[`*.;]+$/, "");
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

export function matchTrace(targets: TraceTargets, covers: string[], known: Set<string>): TraceReport {
  const required = new Set(targets.required);
  const given = new Set(covers);
  const covered = targets.required.filter((r) => given.has(r));
  const uncovered = targets.required.filter((r) => !given.has(r));
  const unknown = covers.filter((r) => !known.has(r) && !required.has(r)).sort();
  const outOfScope = covers.filter((r) => known.has(r) && !required.has(r)).sort();
  return {
    ok: uncovered.length === 0 && unknown.length === 0,
    required: targets.required,
    applicable: targets.applicable,
    covered,
    uncovered,
    unknown,
    outOfScope,
  };
}
