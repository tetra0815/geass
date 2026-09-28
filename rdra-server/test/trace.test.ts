import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import type { Model } from "../src/model/kinds.js";
import { knownRefs, matchTrace, parseCovers, traceTargets } from "../src/trace.js";
import { sampleModel } from "./fixtures.js";

function baseModel(): Model {
  const m = sampleModel();
  m.usecases.push({
    id: "uc.browse",
    name: "商品を見る",
    actors: [],
    screens: [],
    events: [],
    information: [],
    transitions: [],
    acceptance: [{ id: "ac1", when: "開く", then: "一覧が出る" }],
  });
  m.principles.push(
    { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
    { id: "pr.fast", name: "速い", category: "quality", level: "should", scope: ["uc.place-order"] },
    { id: "pr.tdd", name: "TDD", category: "engineering", level: "must", scope: [] },
    { id: "pr.pii", name: "個人情報は国内", category: "security", level: "must", scope: [] },
  );
  return m;
}

describe("traceTargets", () => {
  it("requires every criterion of changed usecases and must principles scoped to them", () => {
    const base = baseModel();
    const head = baseModel();
    head.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られる" },
      { id: "ac2", when: "取り消す", then: "取り消される" },
    ];
    expect(traceTargets(head, diffModels(base, head))).toEqual({
      required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"],
      applicable: ["pr.tdd"],
    });
  });

  it("requires changed must principles even without a changed usecase, but never engineering or technology ones without scope", () => {
    const base = baseModel();
    const head = baseModel();
    head.principles.find((p) => p.id === "pr.pii")!.description = "国内リージョンのみ";
    head.principles.find((p) => p.id === "pr.tdd")!.description = "テストから書く";
    head.principles.push({ id: "pr.stack", name: "TypeScript", category: "technology", level: "must", scope: [] });
    expect(traceTargets(head, diffModels(base, head))).toEqual({ required: ["pr.pii"], applicable: ["pr.stack", "pr.tdd"] });
  });

  it("ignores removed usecases and should principles", () => {
    const base = baseModel();
    const head = baseModel();
    head.usecases = head.usecases.filter((u) => u.id !== "uc.browse");
    head.principles.find((p) => p.id === "pr.fast")!.name = "もっと速い";
    expect(traceTargets(head, diffModels(base, head)).required).toEqual([]);
  });
});

describe("parseCovers", () => {
  it("reads plain, bulleted, bold and backticked Covers lines, skipping code fences", () => {
    const plan = [
      "### Task 1",
      "Covers: uc.place-order#ac1, pr.audit",
      "- Covers: uc.place-order#ac2",
      "**Covers:** `uc.browse#ac1`、`pr.pii`",
      "**Covers**: pr.audit",
      "```markdown",
      "Covers: uc.example#ac9",
      "```",
      "covers: uc.lowercase#ac1",
      "Not a Covers: line",
    ].join("\n");
    expect(parseCovers(plan)).toEqual(["uc.place-order#ac1", "pr.audit", "uc.place-order#ac2", "uc.browse#ac1", "pr.pii"]);
  });
});

describe("matchTrace", () => {
  it("classifies covered, uncovered, unknown and out-of-scope references", () => {
    const model = baseModel();
    const report = matchTrace(
      { required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"], applicable: ["pr.tdd"] },
      ["uc.place-order#ac1", "pr.audit", "uc.browse#ac1", "uc.place-order#ac9", "pr.nope"],
      knownRefs(model),
    );
    expect(report).toEqual({
      ok: false,
      required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"],
      applicable: ["pr.tdd"],
      covered: ["pr.audit", "uc.place-order#ac1"],
      uncovered: ["uc.place-order#ac2"],
      unknown: ["pr.nope", "uc.place-order#ac9"],
      outOfScope: ["uc.browse#ac1"],
    });
  });

  it("passes when everything is covered, even with out-of-scope references", () => {
    const report = matchTrace({ required: ["pr.audit"], applicable: [] }, ["pr.audit", "uc.browse#ac1"], knownRefs(baseModel()));
    expect(report.ok).toBe(true);
    expect(report.outOfScope).toEqual(["uc.browse#ac1"]);
  });

  it("knows element ids and acceptance references", () => {
    const known = knownRefs(baseModel());
    expect(known.has("uc.browse#ac1")).toBe(true);
    expect(known.has("pr.tdd")).toBe(true);
    expect(known.has("scr.cart")).toBe(true);
    expect(known.has("uc.browse#ac2")).toBe(false);
  });
});
