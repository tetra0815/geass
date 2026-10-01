import { KINDS, SLUG, type AnyElement, type Model } from "./kinds.js";

export const RELATION_KINDS = [
  "buc.actor",
  "buc.usecase",
  "uc.actor",
  "uc.screen",
  "uc.event",
  "uc.information",
  "uc.transition",
  "evt.source",
  "evt.target",
  "inf.related",
  "st.information",
  "pr.scope",
  "comp.depends",
  "comp.realizes",
  "comp.holds",
  "tbl.store",
  "tbl.realizes",
  "tbl.state",
  "tbl.related",
  "adr.affects",
  "adr.basis",
  "adr.superseded-by",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_FIELDS: Record<RelationKind, { field: string; shape: "ids" | "refs" | "single" }> = {
  "buc.actor": { field: "actors", shape: "ids" },
  "buc.usecase": { field: "usecases", shape: "ids" },
  "uc.actor": { field: "actors", shape: "ids" },
  "uc.screen": { field: "screens", shape: "ids" },
  "uc.event": { field: "events", shape: "ids" },
  "uc.information": { field: "information", shape: "refs" },
  "uc.transition": { field: "transitions", shape: "ids" },
  "evt.source": { field: "source", shape: "single" },
  "evt.target": { field: "target", shape: "single" },
  "inf.related": { field: "related", shape: "refs" },
  "st.information": { field: "information", shape: "single" },
  "pr.scope": { field: "scope", shape: "ids" },
  "comp.depends": { field: "dependsOn", shape: "refs" },
  "comp.realizes": { field: "realizes", shape: "ids" },
  "comp.holds": { field: "holds", shape: "ids" },
  "tbl.store": { field: "store", shape: "single" },
  "tbl.realizes": { field: "realizes", shape: "ids" },
  "tbl.state": { field: "states", shape: "ids" },
  "tbl.related": { field: "related", shape: "refs" },
  "adr.affects": { field: "affects", shape: "ids" },
  "adr.basis": { field: "basis", shape: "ids" },
  "adr.superseded-by": { field: "supersededBy", shape: "single" },
};

export const RELATION_TARGET_PREFIXES: Record<RelationKind, readonly string[]> = {
  "buc.actor": ["act"],
  "buc.usecase": ["uc"],
  "uc.actor": ["act"],
  "uc.screen": ["scr"],
  "uc.event": ["evt"],
  "uc.information": ["inf"],
  "uc.transition": ["st"],
  "evt.source": ["act", "ext"],
  "evt.target": ["act", "ext"],
  "inf.related": ["inf"],
  "st.information": ["inf"],
  "pr.scope": ["act", "ext", "buc", "uc", "scr", "inf", "st"],
  "comp.depends": ["comp"],
  "comp.realizes": ["ext", "pr"],
  "comp.holds": ["inf"],
  "tbl.store": ["comp"],
  "tbl.realizes": ["inf"],
  "tbl.state": ["st"],
  "tbl.related": ["tbl"],
  "adr.affects": ["comp", "tbl"],
  "adr.basis": ["pr"],
  "adr.superseded-by": ["adr"],
};

export interface Relation {
  from: string;
  to: string;
  kind: RelationKind;
  attrs: Record<string, string>;
}

export function relationSourcePrefix(kind: RelationKind): string {
  return kind.split(".")[0];
}

export function elementFields(element: AnyElement): Record<string, unknown> {
  return element as unknown as Record<string, unknown>;
}

export function relationsOf(model: Model): Relation[] {
  const relations: Relation[] = [];
  for (const kind of RELATION_KINDS) {
    const { field, shape } = RELATION_FIELDS[kind];
    const source = KINDS.find((k) => k.prefix === relationSourcePrefix(kind));
    if (!source) continue;
    for (const element of model[source.key] as AnyElement[]) {
      const value = elementFields(element)[field];
      if (shape === "ids") {
        for (const to of value as string[]) relations.push({ from: element.id, to, kind, attrs: {} });
      } else if (shape === "refs") {
        for (const entry of value as Record<string, string>[]) {
          const { ref, ...attrs } = entry;
          relations.push({ from: element.id, to: ref, kind, attrs });
        }
      } else if (typeof value === "string") {
        relations.push({ from: element.id, to: value, kind, attrs: {} });
      }
    }
  }
  return relations;
}

export interface TransitionRef {
  model: string;
  from: string;
  to: string;
}

const transitionPattern = new RegExp(`^(st\\.${SLUG}):(${SLUG})->(${SLUG})$`);

export function parseTransitionRef(ref: string): TransitionRef | null {
  const m = transitionPattern.exec(ref);
  return m ? { model: m[1], from: m[2], to: m[3] } : null;
}

export function formatTransitionRef(t: TransitionRef): string {
  return `${t.model}:${t.from}->${t.to}`;
}
