import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { parseModel } from "../src/model/io.js";
import { formatTransitionRef, parseTransitionRef, relationsOf } from "../src/model/relations.js";
import { hasErrors, validate, validateChanges, validateDesignChanges } from "../src/validate.js";
import { emptyModel, type Model } from "../src/model/kinds.js";
import { sampleFiles, sampleFullModel, sampleModel } from "./fixtures.js";

const codes = (files: Record<string, string>) => validate(parseModel(files)).map((i) => `${i.level}:${i.code}:${i.elementId ?? ""}`);

describe("relationsOf", () => {
  it("extracts every relation of the sample model with attrs", () => {
    const rels = relationsOf(sampleModel());
    expect(rels).toContainEqual({ from: "uc.place-order", to: "inf.order", kind: "uc.information", attrs: { access: "create" } });
    expect(rels).toContainEqual({ from: "uc.place-order", to: "st.order:draft->placed", kind: "uc.transition", attrs: {} });
    expect(rels).toContainEqual({ from: "evt.payment-request", to: "ext.payment-gateway", kind: "evt.target", attrs: {} });
    expect(rels).toContainEqual({ from: "st.order", to: "inf.order", kind: "st.information", attrs: {} });
    expect(rels).toHaveLength(9);
  });

  it("extracts design relations with attrs", () => {
    const design = relationsOf(sampleFullModel())
      .filter((r) => ["comp", "tbl", "adr"].includes(r.from.split(".")[0]))
      .map((r) => `${r.kind}|${r.from}|${r.to}|${JSON.stringify(r.attrs)}`)
      .sort();
    expect(design).toEqual([
      "adr.affects|adr.postgres|comp.db|{}",
      'comp.depends|comp.web|comp.db|{"label":"注文の読み書き"}',
      "comp.depends|comp.web|comp.payment-adapter|{}",
      "comp.realizes|comp.payment-adapter|ext.payment-gateway|{}",
      "tbl.realizes|tbl.orders|inf.order|{}",
      "tbl.state|tbl.orders|st.order|{}",
      "tbl.store|tbl.orders|comp.db|{}",
    ]);
  });
});

describe("transition refs", () => {
  it("parses and formats", () => {
    expect(parseTransitionRef("st.order:draft->placed")).toEqual({ model: "st.order", from: "draft", to: "placed" });
    expect(parseTransitionRef("st.order:draft")).toBeNull();
    expect(formatTransitionRef({ model: "st.order", from: "a", to: "b" })).toBe("st.order:a->b");
  });
});

describe("validate", () => {
  it("finds no issues in the sample model", () => {
    expect(validate(sampleModel())).toEqual([]);
  });

  it("flags duplicate ids", () => {
    const files = sampleFiles();
    files["actors.yaml"] += "- id: act.customer\n  name: 重複\n";
    expect(codes(files)).toContain("error:duplicate-id:act.customer");
  });

  it("flags dangling and wrong-kind references", () => {
    const files = sampleFiles();
    files["bucs.yaml"] = "- id: buc.ordering\n  name: 注文受付\n  actors: [act.ghost, scr.cart]\n  usecases: [uc.place-order]\n";
    const c = codes(files);
    expect(c).toContain("error:dangling-ref:buc.ordering");
    expect(c).toContain("error:wrong-kind-ref:buc.ordering");
  });

  it("flags transition refs to unknown models, unknown transitions and bad syntax", () => {
    const files = sampleFiles();
    files["usecases.yaml"] = [
      "- id: uc.place-order",
      "  name: 注文する",
      "  screens: [scr.cart]",
      "  information: [{ ref: inf.order, access: create }]",
      "  transitions: [\"st.ghost:a->b\", \"st.order:placed->draft\", \"st.order\"]",
      "",
    ].join("\n");
    const c = codes(files);
    expect(c).toContain("error:dangling-ref:uc.place-order");
    expect(c).toContain("error:unknown-transition:uc.place-order");
    expect(c).toContain("error:bad-transition-ref:uc.place-order");
  });

  it("flags state models whose transitions use undeclared or duplicate states", () => {
    const files = sampleFiles();
    files["states.yaml"] = [
      "- id: st.order",
      "  name: 注文状態",
      "  states: [{ id: draft, name: a }, { id: draft, name: b }, { id: placed, name: c }]",
      "  transitions: [{ from: draft, to: placed }, { from: draft, to: shipped }]",
      "",
    ].join("\n");
    const c = codes(files);
    expect(c).toContain("error:duplicate-state:st.order");
    expect(c).toContain("error:unknown-state:st.order");
  });

  it("warns about loose ends without making them errors", () => {
    const files = {
      "usecases.yaml": "- id: uc.lonely\n  name: 孤立\n",
      "information.yaml": "- id: inf.unused\n  name: 未使用\n",
      "states.yaml": "- id: st.s\n  name: S\n  states: [{ id: a, name: A }, { id: b, name: B }]\n  transitions: [{ from: a, to: b }]\n",
    };
    const issues = validate(parseModel(files));
    expect(hasErrors(issues)).toBe(false);
    expect(issues.map((i) => i.code).sort()).toEqual([
      "unused-information",
      "unused-transition",
      "usecase-without-buc",
      "usecase-without-io",
    ]);
  });

  describe("principles", () => {
    const withPrinciples = (yaml: string) => ({ ...sampleFiles(), "principles.yaml": yaml });

    it("links principles to their scope and accepts a valid model", () => {
      const files = withPrinciples(
        "- id: pr.audit\n  name: 監査ログ\n  description: 全更新を記録する\n  category: security\n  level: must\n  scope: [uc.place-order, inf.order]\n",
      );
      expect(relationsOf(parseModel(files))).toContainEqual({ from: "pr.audit", to: "uc.place-order", kind: "pr.scope", attrs: {} });
      expect(codes(files)).toEqual([]);
    });

    it("flags dangling and wrong-kind scope targets", () => {
      const files = withPrinciples(
        "- id: pr.a\n  name: A\n  description: d\n  category: security\n  level: must\n  scope: [uc.none, evt.payment-request]\n",
      );
      expect(codes(files)).toEqual(expect.arrayContaining(["error:dangling-ref:pr.a", "error:wrong-kind-ref:pr.a"]));
    });

    it("warns about must principles without a description", () => {
      const files = withPrinciples(
        "- id: pr.a\n  name: A\n  category: quality\n  level: must\n- id: pr.b\n  name: B\n  category: quality\n  level: should\n",
      );
      expect(codes(files)).toEqual(["warning:principle-without-description:pr.a"]);
    });
  });

  describe("acceptance", () => {
    const withAcceptance = (lines: string[]) => {
      const files = sampleFiles();
      files["usecases.yaml"] += ["  acceptance:", ...lines, ""].join("\n");
      return files;
    };

    it("accepts well-formed criteria", () => {
      expect(codes(withAcceptance(["    - { id: ac1, given: 在庫あり, when: 注文する, then: 注文が作られる }"]))).toEqual([]);
    });

    it("flags duplicate ids and blank when/then", () => {
      expect(
        codes(
          withAcceptance([
            "    - { id: ac1, when: 注文する, then: 作られる }",
            "    - { id: ac1, when: 注文する, then: 作られる }",
            '    - { id: ac2, when: 注文する, then: "   " }',
            '    - { id: ac3, when: "", then: 作られる }',
          ]),
        ),
      ).toEqual([
        "error:duplicate-acceptance:uc.place-order",
        "error:empty-acceptance:uc.place-order",
        "error:empty-acceptance:uc.place-order",
      ]);
    });
  });
});

describe("validateChanges", () => {
  it("requires acceptance criteria only on added or modified usecases", () => {
    const base = sampleModel();
    const head = sampleModel();
    head.usecases[0].name = "注文を確定する";
    head.screens[0].name = "カート画面";
    expect(validateChanges(diffModels(base, head)).map((i) => `${i.level}:${i.code}:${i.elementId}`)).toEqual([
      "error:usecase-without-acceptance:uc.place-order",
    ]);
    head.usecases[0].acceptance.push({ id: "ac1", when: "注文する", then: "作られる" });
    expect(validateChanges(diffModels(base, head))).toEqual([]);
  });

  it("ignores removed usecases and unchanged ones", () => {
    const head = sampleModel();
    head.usecases = [];
    expect(validateChanges(diffModels(sampleModel(), head))).toEqual([]);
    expect(validateChanges(diffModels(sampleModel(), sampleModel()))).toEqual([]);
    expect(validateChanges(diffModels(emptyModel(), emptyModel()))).toEqual([]);
  });
});

const tags = (issues: { level: string; code: string; elementId?: string }[]) => issues.map((i) => `${i.level}:${i.code}:${i.elementId ?? ""}`).sort();

describe("validate (design)", () => {
  it("finds no issues in the sample design", () => {
    expect(validate(sampleFullModel())).toEqual([]);
  });

  it("requires a table's store to be a datastore and its refs to be of the right kind", () => {
    const m = sampleFullModel();
    m.tables[0].store = "comp.web";
    m.tables[0].related = [{ ref: "inf.order" }];
    expect(tags(validate(m))).toEqual(["error:table-store-not-datastore:tbl.orders", "error:wrong-kind-ref:tbl.orders"]);
  });

  it("requires a table's state models to describe information the table realizes", () => {
    const m = sampleFullModel();
    m.information.push({ id: "inf.stock", name: "在庫", attributes: [], related: [] });
    m.tables[0].realizes = ["inf.stock"];
    expect(tags(validate(m)).filter((t) => t.startsWith("error"))).toEqual(["error:table-state-mismatch:tbl.orders"]);
  });

  it("requires a superseded decision to name a successor that is still in force", () => {
    const m = sampleFullModel();
    m.decisions[0].status = "superseded";
    expect(tags(validate(m))).toEqual(["error:decision-without-successor:adr.postgres"]);
    m.decisions.push({ id: "adr.aurora", name: "Aurora", status: "superseded", context: "c", decision: "d", alternatives: [], affects: [], basis: [], supersededBy: "adr.postgres" });
    m.decisions[0].supersededBy = "adr.aurora";
    expect(tags(validate(m))).toEqual([
      "error:decision-successor-superseded:adr.aurora",
      "error:decision-successor-superseded:adr.postgres",
    ]);
  });

  it("warns about isolated components and, when it can look, missing docs", () => {
    const m = sampleFullModel();
    m.components.push({ id: "comp.batch", name: "バッチ", type: "worker", dependsOn: [], realizes: [], holds: [] });
    m.tables[0].doc = "docs/design/er.md";
    expect(tags(validate(m, { fileExists: (p) => p !== "docs/design/er.md" }))).toEqual([
      "warning:isolated-component:comp.batch",
      "warning:missing-doc:tbl.orders",
    ]);
    expect(tags(validate(m))).toEqual(["warning:isolated-component:comp.batch"]);
  });
});

describe("validateDesignChanges", () => {
  function touchOrderAndGateway(m: Model): Model {
    m.information[0].attributes.push("合計金額");
    m.externalSystems[0].name = "決済代行サービス";
    m.states[0].name = "注文の状態";
    return m;
  }

  it("requires added or changed information and external systems to be realized", () => {
    const head = touchOrderAndGateway(sampleModel());
    expect(tags(validateDesignChanges(head, diffModels(sampleModel(), head)))).toEqual([
      "error:external-system-not-realized:ext.payment-gateway",
      "error:information-not-realized:inf.order",
    ]);
  });

  it("is satisfied by the sample design, and asks for the state on the realizing table", () => {
    const head = touchOrderAndGateway(sampleFullModel());
    expect(validateDesignChanges(head, diffModels(sampleFullModel(), head))).toEqual([]);
    head.tables[0].states = [];
    expect(tags(validateDesignChanges(head, diffModels(sampleFullModel(), head)))).toEqual(["error:state-not-stored:st.order"]);
  });

  it("accepts information held by a component and then does not ask for a table state", () => {
    const head = touchOrderAndGateway(sampleFullModel());
    head.tables = [];
    head.components.find((c) => c.id === "comp.payment-adapter")!.holds = ["inf.order"];
    expect(validateDesignChanges(head, diffModels(sampleFullModel(), head))).toEqual([]);
  });

  it("ignores removed elements and warns about unrealized technology principles", () => {
    const head = sampleFullModel();
    head.externalSystems = [];
    head.principles.push({ id: "pr.postgres", name: "PostgreSQL を使う", category: "technology", level: "must", scope: [] });
    expect(tags(validateDesignChanges(head, diffModels(sampleFullModel(), head)))).toEqual([
      "warning:technology-principle-not-realized:pr.postgres",
    ]);
    head.decisions[0].basis = ["pr.postgres"];
    expect(validateDesignChanges(head, diffModels(sampleFullModel(), head))).toEqual([]);
  });
});
