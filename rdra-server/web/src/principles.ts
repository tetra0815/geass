import type { ChangeType, ElementChange } from "../../src/diff.js";
import { PRINCIPLE_CATEGORIES, type Model, type Principle } from "../../src/model/kinds.js";

export const CATEGORY_LABELS: Record<Principle["category"], string> = {
  business: "業務",
  quality: "品質",
  security: "セキュリティ",
  engineering: "開発プロセス",
  technology: "技術",
};

export interface PrincipleRow {
  principle: Principle;
  status?: ChangeType;
}

export interface PrincipleGroup {
  category: Principle["category"];
  label: string;
  rows: PrincipleRow[];
}

const byId = (a: Principle, b: Principle) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function groupPrinciples(model: Model, changes: ElementChange[] = []): PrincipleGroup[] {
  const own = changes.filter((c) => c.kind === "principles");
  const statusOf = new Map(own.map((c) => [c.id, c.type]));
  const removed = own.filter((c) => c.type === "removed" && c.before).map((c) => c.before as Principle);
  const all = [...model.principles, ...removed].sort(byId);
  return PRINCIPLE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rows: all.filter((p) => p.category === category).map((p) => ({ principle: p, status: statusOf.get(p.id) })),
  })).filter((g) => g.rows.length > 0);
}

export function mustPrinciplesFor(model: Model, id: string): Principle[] {
  return model.principles.filter((p) => p.level === "must" && p.scope.includes(id));
}

export function parseScope(text: string): string[] {
  return text
    .split(/[\s,、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
