import { describe, expect, it } from "vitest";
import {
  ActorSchema,
  KINDS,
  UsecaseSchema,
  StateModelSchema,
  emptyModel,
  findElement,
  kindOfId,
} from "../src/model/kinds.js";

describe("kinds", () => {
  it("accepts a well-formed actor", () => {
    expect(ActorSchema.parse({ id: "act.customer", name: "顧客" })).toEqual({ id: "act.customer", name: "顧客" });
  });

  it("rejects an id with the wrong prefix or a non-slug", () => {
    expect(ActorSchema.safeParse({ id: "uc.customer", name: "x" }).success).toBe(false);
    expect(ActorSchema.safeParse({ id: "act.Customer", name: "x" }).success).toBe(false);
    expect(ActorSchema.safeParse({ id: "act.customer", name: "" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(ActorSchema.safeParse({ id: "act.a", name: "A", extra: 1 }).success).toBe(false);
  });

  it("fills relation arrays with fresh empty arrays", () => {
    const a = UsecaseSchema.parse({ id: "uc.a", name: "A" });
    const b = UsecaseSchema.parse({ id: "uc.b", name: "B" });
    expect(a.actors).toEqual([]);
    expect(a.information).toEqual([]);
    expect(a.actors).not.toBe(b.actors);
  });

  it("requires an access type on usecase information refs", () => {
    expect(UsecaseSchema.safeParse({ id: "uc.a", name: "A", information: [{ ref: "inf.x" }] }).success).toBe(false);
    expect(UsecaseSchema.safeParse({ id: "uc.a", name: "A", information: [{ ref: "inf.x", access: "update" }] }).success).toBe(true);
  });

  it("requires state ids to be slugs", () => {
    expect(StateModelSchema.safeParse({ id: "st.o", name: "O", states: [{ id: "Draft", name: "d" }] }).success).toBe(false);
  });

  it("resolves kinds by id prefix", () => {
    expect(kindOfId("uc.place-order")?.key).toBe("usecases");
    expect(kindOfId("st.order")?.key).toBe("states");
    expect(kindOfId("zz.x")).toBeUndefined();
    expect(KINDS.map((k) => k.file)).toEqual([
      "actors.yaml",
      "external-systems.yaml",
      "bucs.yaml",
      "usecases.yaml",
      "screens.yaml",
      "events.yaml",
      "information.yaml",
      "states.yaml",
    ]);
  });

  it("finds elements across kinds", () => {
    const m = emptyModel();
    m.screens.push({ id: "scr.cart", name: "カート" });
    expect(findElement(m, "scr.cart")?.index).toBe(0);
    expect(findElement(m, "scr.none")).toBeUndefined();
  });
});
