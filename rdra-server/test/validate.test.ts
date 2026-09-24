import { describe, expect, it } from "vitest";
import { parseModel } from "../src/model/io.js";
import { formatTransitionRef, parseTransitionRef, relationsOf } from "../src/model/relations.js";
import { hasErrors, validate } from "../src/validate.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

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
});
