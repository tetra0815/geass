import type { RelationKind } from "../../src/model/relations.js";

export interface LinkIntent {
  relation: RelationKind;
  from: string;
  to: string;
  attrs?: Record<string, string>;
}

export interface TransitionIntent {
  model: string;
  from: string;
  to: string;
}

const PAIRS: readonly [string, string, RelationKind][] = [
  ["buc", "act", "buc.actor"],
  ["buc", "uc", "buc.usecase"],
  ["uc", "act", "uc.actor"],
  ["uc", "scr", "uc.screen"],
  ["uc", "evt", "uc.event"],
  ["uc", "inf", "uc.information"],
  ["uc", "st", "uc.transition"],
  ["evt", "act", "evt.target"],
  ["evt", "ext", "evt.target"],
  ["inf", "inf", "inf.related"],
  ["st", "inf", "st.information"],
  ["comp", "comp", "comp.depends"],
  ["comp", "ext", "comp.realizes"],
  ["comp", "inf", "comp.holds"],
  ["tbl", "comp", "tbl.store"],
  ["tbl", "inf", "tbl.realizes"],
  ["tbl", "st", "tbl.state"],
  ["tbl", "tbl", "tbl.related"],
];

const prefixOf = (id: string) => id.split(/[.:]/, 1)[0];

function withDefaults(intent: LinkIntent): LinkIntent {
  return intent.relation === "uc.information" ? { ...intent, attrs: { access: "read" } } : intent;
}

export function inferLink(a: string, b: string): LinkIntent | null {
  const pa = prefixOf(a);
  const pb = prefixOf(b);
  for (const [source, target, relation] of PAIRS) {
    if (relation === "uc.transition") continue;
    if (pa === source && pb === target) return withDefaults({ relation, from: a, to: b });
    if (pa === target && pb === source) {
      if (relation === "evt.target") return { relation: "evt.source", from: b, to: a };
      return withDefaults({ relation, from: b, to: a });
    }
  }
  return null;
}

export function inferTransition(a: string, b: string): TransitionIntent | null {
  const pa = a.split(":");
  const pb = b.split(":");
  if (pa.length !== 2 || pb.length !== 2 || pa[0] !== pb[0] || !pa[0].startsWith("st.") || pa[1] === pb[1]) return null;
  return { model: pa[0], from: pa[1], to: pb[1] };
}

export function relationsFrom(prefix: string): { relation: RelationKind; targetPrefix: string }[] {
  const out: { relation: RelationKind; targetPrefix: string }[] = [];
  for (const [source, target, relation] of PAIRS) if (source === prefix) out.push({ relation, targetPrefix: target });
  if (prefix === "evt") {
    out.push({ relation: "evt.source", targetPrefix: "act" }, { relation: "evt.source", targetPrefix: "ext" });
  }
  return out;
}
