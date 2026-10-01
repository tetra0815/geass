import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { parseModel } from "../src/model/io.js";
import { inferLink, inferTransition, relationsFrom } from "../web/src/infer.js";
import { activeStage } from "../web/src/review-stage.js";
import { projectView, viewForId } from "../web/src/views.js";
import { emptyReview, requestReview } from "../src/review.js";
import { sampleFiles, sampleFullModel, sampleModel } from "./fixtures.js";

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("projectView", () => {
  it("draws components with their dependencies and the external systems they realize", () => {
    const d = projectView("component-diagram", sampleFullModel());
    expect(ids(d.nodes)).toEqual(["comp.db", "comp.payment-adapter", "comp.web", "ext.payment-gateway"]);
    expect(d.edges.find((e) => e.target === "comp.db")).toMatchObject({ relation: "comp.depends", source: "comp.web", label: "注文の読み書き" });
    expect(d.edges.find((e) => e.relation === "comp.realizes")).toMatchObject({ source: "comp.payment-adapter", target: "ext.payment-gateway" });
    expect(d.nodes.find((n) => n.id === "comp.db")?.label).toBe("業務 DB [datastore]");
  });

  it("draws tables with their datastore and the information they realize", () => {
    const d = projectView("data-model", sampleFullModel());
    expect(ids(d.nodes)).toEqual(["comp.db", "inf.order", "tbl.orders"]);
    expect(d.edges.map((e) => e.relation).sort()).toEqual(["tbl.realizes", "tbl.store"]);
  });

  it("draws the system context with a system node and event labels", () => {
    const d = projectView("system-context", sampleModel());
    expect(ids(d.nodes)).toEqual(["act.customer", "ext.payment-gateway", "system"]);
    expect(d.edges.find((e) => e.source === "ext.payment-gateway")).toMatchObject({ target: "system", label: "決済依頼" });
  });

  it("draws the business flow from BUC relations", () => {
    const d = projectView("business-flow", sampleModel());
    expect(ids(d.nodes)).toEqual(["act.customer", "buc.ordering", "uc.place-order"]);
    expect(d.edges.map((e) => e.relation).sort()).toEqual(["buc.actor", "buc.usecase"]);
  });

  it("draws the usecase composite with access labels and transitions onto the state model", () => {
    const d = projectView("usecase-composite", sampleModel());
    expect(d.edges.find((e) => e.relation === "uc.information")).toMatchObject({ target: "inf.order", label: "create" });
    expect(d.edges.find((e) => e.relation === "uc.transition")).toMatchObject({ target: "st.order", label: "draft→placed" });
    expect(d.edges.find((e) => e.relation === "evt.target")).toMatchObject({ source: "evt.payment-request", target: "ext.payment-gateway" });
  });

  it("draws state models as groups of states with transitions labelled by usecases", () => {
    const d = projectView("state-model", sampleModel());
    expect(d.nodes.map((n) => `${n.id}|${n.parent ?? ""}`)).toEqual(["st.order|", "st.order:draft|st.order", "st.order:placed|st.order"]);
    expect(d.edges).toEqual([
      expect.objectContaining({ source: "st.order:draft", target: "st.order:placed", label: "注文する", to: "st.order:draft->placed" }),
    ]);
  });

  it("marks added, modified and removed elements and relations", () => {
    const files = sampleFiles();
    files["screens.yaml"] = "- id: scr.confirm\n  name: 確認\n";
    files["usecases.yaml"] = files["usecases.yaml"].replace("screens: [scr.cart]", "screens: [scr.confirm]");
    const head = parseModel(files);
    const d = projectView("usecase-composite", head, diffModels(sampleModel(), head));
    expect(d.nodes.find((n) => n.id === "scr.confirm")?.status).toBe("added");
    expect(d.nodes.find((n) => n.id === "scr.cart")?.status).toBe("removed");
    expect(d.nodes.find((n) => n.id === "uc.place-order")?.status).toBe("modified");
    expect(d.edges.find((e) => e.target === "scr.confirm")?.status).toBe("added");
    expect(d.edges.find((e) => e.target === "scr.cart")?.status).toBe("removed");
  });

  it("counts must principles on usecases in the usecase composite", () => {
    const m = sampleModel();
    m.principles.push(
      { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
      { id: "pr.fast", name: "速い", category: "quality", level: "should", scope: ["uc.place-order"] },
    );
    const d = projectView("usecase-composite", m);
    expect(d.nodes.find((n) => n.id === "uc.place-order")?.principles).toBe(1);
    expect(d.nodes.find((n) => n.id === "scr.cart")?.principles).toBeUndefined();
  });

  it("maps ids to their home view", () => {
    expect(viewForId("comp.db")).toBe("component-diagram");
    expect(viewForId("tbl.orders")).toBe("data-model");
    expect(viewForId("act.a")).toBe("system-context");
    expect(viewForId("buc.a")).toBe("business-flow");
    expect(viewForId("scr.a")).toBe("usecase-composite");
    expect(viewForId("inf.a")).toBe("information-model");
    expect(viewForId("st.a")).toBe("state-model");
  });
});

describe("inferLink", () => {
  it("links tables to their datastore and information", () => {
    expect(inferLink("comp.db", "tbl.orders")).toEqual({ relation: "tbl.store", from: "tbl.orders", to: "comp.db" });
    expect(inferLink("tbl.orders", "inf.order")).toEqual({ relation: "tbl.realizes", from: "tbl.orders", to: "inf.order" });
    expect(inferLink("comp.web", "ext.payment-gateway")).toEqual({ relation: "comp.realizes", from: "comp.web", to: "ext.payment-gateway" });
  });

  it("orients relations regardless of drag direction", () => {
    expect(inferLink("uc.a", "scr.b")).toEqual({ relation: "uc.screen", from: "uc.a", to: "scr.b" });
    expect(inferLink("scr.b", "uc.a")).toEqual({ relation: "uc.screen", from: "uc.a", to: "scr.b" });
    expect(inferLink("act.x", "buc.y")).toEqual({ relation: "buc.actor", from: "buc.y", to: "act.x" });
  });

  it("defaults information access to read and handles event direction", () => {
    expect(inferLink("inf.o", "uc.a")).toEqual({ relation: "uc.information", from: "uc.a", to: "inf.o", attrs: { access: "read" } });
    expect(inferLink("evt.e", "ext.p")).toEqual({ relation: "evt.target", from: "evt.e", to: "ext.p" });
    expect(inferLink("ext.p", "evt.e")).toEqual({ relation: "evt.source", from: "evt.e", to: "ext.p" });
  });

  it("returns null for pairs without a relation", () => {
    expect(inferLink("scr.a", "inf.b")).toBeNull();
    expect(inferLink("uc.a", "st.b")).toBeNull();
  });

  it("recognises transitions between states of one model", () => {
    expect(inferTransition("st.o:draft", "st.o:placed")).toEqual({ model: "st.o", from: "draft", to: "placed" });
    expect(inferTransition("st.o:draft", "st.p:placed")).toBeNull();
    expect(inferTransition("uc.a", "st.o:placed")).toBeNull();
  });

  it("lists the relations an element kind can start", () => {
    expect(relationsFrom("evt").map((r) => `${r.relation}>${r.targetPrefix}`)).toEqual([
      "evt.target>act",
      "evt.target>ext",
      "evt.source>act",
      "evt.source>ext",
    ]);
  });
});

describe("activeStage", () => {
  const pending = requestReview(emptyReview(), { now: "t" });
  it("decides on the RDRA review first, then the design review", () => {
    expect(activeStage({ review: pending, design: { review: pending, approval: "pending", required: true } })).toBe("rdra");
    expect(activeStage({ review: emptyReview(), design: { review: pending, approval: "pending", required: true } })).toBe("design");
    expect(activeStage({ review: null, design: { review: null, approval: "none", required: false } })).toBeNull();
  });
});
