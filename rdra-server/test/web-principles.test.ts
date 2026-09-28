import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { groupPrinciples, mustPrinciplesFor, parseScope } from "../web/src/principles.js";
import { sampleModel } from "./fixtures.js";

function withPrinciples() {
  const m = sampleModel();
  m.principles.push(
    { id: "pr.tdd", name: "TDD", category: "engineering", level: "must", scope: [] },
    { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
    { id: "pr.fast", name: "1 秒以内", category: "quality", level: "should", scope: ["uc.place-order"] },
  );
  return m;
}

describe("groupPrinciples", () => {
  it("groups by category in the fixed order and marks diff status, including removed ones", () => {
    const base = withPrinciples();
    const head = withPrinciples();
    head.principles = head.principles.filter((p) => p.id !== "pr.fast");
    head.principles.find((p) => p.id === "pr.audit")!.name = "監査ログ";
    head.principles.push({ id: "pr.gdpr", name: "個人情報", category: "security", level: "must", scope: [] });
    const groups = groupPrinciples(head, diffModels(base, head));
    expect(groups.map((g) => g.label)).toEqual(["品質", "セキュリティ", "開発プロセス"]);
    expect(groups[0].rows).toEqual([{ principle: expect.objectContaining({ id: "pr.fast" }), status: "removed" }]);
    expect(groups[1].rows.map((r) => `${r.principle.id}:${r.status ?? ""}`)).toEqual(["pr.audit:modified", "pr.gdpr:added"]);
    expect(groups[2].rows[0].status).toBeUndefined();
  });
});

describe("mustPrinciplesFor", () => {
  it("returns only must principles scoped to the element", () => {
    expect(mustPrinciplesFor(withPrinciples(), "uc.place-order").map((p) => p.id)).toEqual(["pr.audit"]);
    expect(mustPrinciplesFor(withPrinciples(), "scr.cart")).toEqual([]);
  });
});

describe("parseScope", () => {
  it("splits on commas, Japanese commas and whitespace", () => {
    expect(parseScope(" uc.a, inf.b、scr.c  st.d ")).toEqual(["uc.a", "inf.b", "scr.c", "st.d"]);
    expect(parseScope("  ")).toEqual([]);
  });
});
