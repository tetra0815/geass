import { describe, expect, it } from "vitest";
import { OperationError, applyOperations } from "../src/operations.js";
import { sampleModel, sampleFullModel } from "./fixtures.js";

describe("applyOperations", () => {
  it("adds a new element with defaults and leaves the input untouched", () => {
    const input = sampleModel();
    const { model } = applyOperations(input, [{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    expect(model.screens.map((s) => s.id)).toEqual(["scr.cart", "scr.top"]);
    expect(input.screens).toHaveLength(1);
  });

  it("merges fields into an existing element", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "usecases", element: { id: "uc.place-order", description: "カートの内容で注文を確定する" } },
    ]);
    const uc = model.usecases[0];
    expect(uc.name).toBe("注文する");
    expect(uc.description).toBe("カートの内容で注文を確定する");
    expect(uc.screens).toEqual(["scr.cart"]);
  });

  it("removes fields set to null", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "events", element: { id: "evt.payment-request", target: null, description: null } },
    ]);
    expect(model.events[0]).toEqual({ id: "evt.payment-request", name: "決済依頼" });
  });

  it("rejects schema violations with the element id in the message", () => {
    expect(() =>
      applyOperations(sampleModel(), [{ op: "upsert", kind: "actors", element: { id: "act.x", name: "" } }]),
    ).toThrow(/act\.x/);
    expect(() => applyOperations(sampleModel(), [{ op: "upsert", kind: "actors", element: { name: "x" } }])).toThrow(OperationError);
  });

  it("deletes an element and every relation pointing at it", () => {
    const { model, removedRelations } = applyOperations(sampleModel(), [{ op: "delete", id: "inf.order" }]);
    expect(model.information).toEqual([]);
    expect(model.usecases[0].information).toEqual([]);
    expect(model.states[0].information).toBeUndefined();
    expect(removedRelations.map((r) => `${r.from}>${r.to}`).sort()).toEqual(["st.order>inf.order", "uc.place-order>inf.order"]);
  });

  it("deleting a state model removes usecase transitions into it", () => {
    const { model } = applyOperations(sampleModel(), [{ op: "delete", id: "st.order" }]);
    expect(model.usecases[0].transitions).toEqual([]);
  });

  it("deleting an element also reports its own outgoing relations", () => {
    const { removedRelations } = applyOperations(sampleModel(), [{ op: "delete", id: "evt.payment-request" }]);
    expect(removedRelations.map((r) => r.kind).sort()).toEqual(["evt.target", "uc.event"]);
  });

  it("rejects deleting an unknown id", () => {
    expect(() => applyOperations(sampleModel(), [{ op: "delete", id: "scr.none" }])).toThrow(OperationError);
  });

  it("links ids, refs with attrs, and single fields", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "screens", element: { id: "scr.confirm", name: "確認" } },
      { op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.confirm" },
      { op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.confirm" },
      { op: "link", relation: "uc.information", from: "uc.place-order", to: "inf.order", attrs: { access: "update" } },
      { op: "link", relation: "evt.source", from: "evt.payment-request", to: "act.customer" },
    ]);
    const uc = model.usecases[0];
    expect(uc.screens).toEqual(["scr.cart", "scr.confirm"]);
    expect(uc.information).toEqual([{ ref: "inf.order", access: "update" }]);
    expect(model.events[0].source).toBe("act.customer");
  });

  it("rejects links from the wrong kind or with missing attrs", () => {
    expect(() =>
      applyOperations(sampleModel(), [{ op: "link", relation: "uc.screen", from: "buc.ordering", to: "scr.cart" }]),
    ).toThrow(OperationError);
    expect(() =>
      applyOperations(sampleModel(), [{ op: "upsert", kind: "information", element: { id: "inf.stock", name: "在庫" } }, { op: "link", relation: "uc.information", from: "uc.place-order", to: "inf.stock" }]),
    ).toThrow(/access/);
  });

  it("unlinks and rejects unlinking a missing relation", () => {
    const { model } = applyOperations(sampleModel(), [{ op: "unlink", relation: "uc.screen", from: "uc.place-order", to: "scr.cart" }]);
    expect(model.usecases[0].screens).toEqual([]);
    expect(() =>
      applyOperations(sampleModel(), [{ op: "unlink", relation: "uc.screen", from: "uc.place-order", to: "scr.none" }]),
    ).toThrow(OperationError);
  });

  it("detaches principle scopes when the target is deleted", () => {
    const model = sampleModel();
    model.principles.push({ id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] });
    const { model: next, removedRelations } = applyOperations(model, [{ op: "delete", id: "uc.place-order" }]);
    expect(next.principles[0].scope).toEqual([]);
    expect(removedRelations).toContainEqual({ from: "pr.audit", to: "uc.place-order", kind: "pr.scope", attrs: {} });
  });

  it("detaches design references when an RDRA element is deleted", () => {
    const { model, removedRelations } = applyOperations(sampleFullModel(), [{ op: "delete", id: "ext.payment-gateway" }]);
    expect(model.components.find((c) => c.id === "comp.payment-adapter")!.realizes).toEqual([]);
    expect(removedRelations.map((r) => `${r.kind}|${r.from}`)).toContain("comp.realizes|comp.payment-adapter");
  });

  it("refuses to leave a table without its store or its information", () => {
    expect(() => applyOperations(sampleFullModel(), [{ op: "delete", id: "comp.db" }])).toThrow(/comp\.db を削除できません.*tbl\.orders/);
    expect(() => applyOperations(sampleFullModel(), [{ op: "delete", id: "inf.order" }])).toThrow(/inf\.order を削除できません.*tbl\.orders/);
    expect(() =>
      applyOperations(sampleFullModel(), [{ op: "unlink", relation: "tbl.store", from: "tbl.orders", to: "comp.db" }]),
    ).toThrow(OperationError);
    expect(() =>
      applyOperations(sampleFullModel(), [{ op: "unlink", relation: "tbl.realizes", from: "tbl.orders", to: "inf.order" }]),
    ).toThrow(/tbl\.orders/);
  });
});
