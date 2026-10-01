import { describe, expect, it } from "vitest";
import {
  AcceptanceSchema,
  ActorSchema,
  ComponentSchema,
  DecisionSchema,
  TableSchema,
  KINDS,
  UsecaseSchema,
  StateModelSchema,
  PrincipleSchema,
  acceptanceRef,
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
    expect(kindOfId("pr.tdd")?.key).toBe("principles");
    expect(KINDS.map((k) => k.file)).toEqual([
      "actors.yaml",
      "external-systems.yaml",
      "bucs.yaml",
      "usecases.yaml",
      "screens.yaml",
      "events.yaml",
      "information.yaml",
      "states.yaml",
      "principles.yaml",
      "components.yaml",
      "tables.yaml",
      "decisions.yaml",
    ]);
  });

  it("puts the design kinds after the RDRA kinds", () => {
    expect(KINDS.filter((k) => k.layer === "design").map((k) => `${k.key}:${k.prefix}`)).toEqual([
      "components:comp",
      "tables:tbl",
      "decisions:adr",
    ]);
    expect(KINDS.slice(0, 9).every((k) => k.layer === "rdra")).toBe(true);
    expect(kindOfId("tbl.orders")?.key).toBe("tables");
  });

  it("parses design elements with defaults and rejects missing required fields", () => {
    expect(ComponentSchema.parse({ id: "comp.db", name: "DB", type: "datastore" })).toEqual({
      id: "comp.db",
      name: "DB",
      type: "datastore",
      dependsOn: [],
      realizes: [],
      holds: [],
    });
    expect(ComponentSchema.safeParse({ id: "comp.db", name: "DB", type: "database" }).success).toBe(false);
    expect(TableSchema.safeParse({ id: "tbl.orders", name: "注文", store: "comp.db", realizes: [] }).success).toBe(false);
    expect(TableSchema.safeParse({ id: "tbl.orders", name: "注文", realizes: ["inf.order"] }).success).toBe(false);
    expect(TableSchema.parse({ id: "tbl.orders", name: "注文", store: "comp.db", realizes: ["inf.order"] })).toMatchObject({ states: [], related: [] });
    expect(DecisionSchema.safeParse({ id: "adr.pg", name: "PG", status: "accepted", context: "c", decision: "" }).success).toBe(false);
    expect(DecisionSchema.safeParse({ id: "adr.pg", name: "PG", status: "done", context: "c", decision: "d" }).success).toBe(false);
    expect(DecisionSchema.parse({ id: "adr.pg", name: "PG", status: "accepted", context: "c", decision: "d" })).toMatchObject({
      alternatives: [],
      affects: [],
      basis: [],
    });
  });

  it("finds elements across kinds", () => {
    const m = emptyModel();
    m.screens.push({ id: "scr.cart", name: "カート" });
    expect(findElement(m, "scr.cart")?.index).toBe(0);
    expect(findElement(m, "scr.none")).toBeUndefined();
  });

  it("accepts a principle with defaults and rejects unknown categories and levels", () => {
    expect(PrincipleSchema.parse({ id: "pr.tdd", name: "TDD", category: "engineering", level: "must" })).toEqual({
      id: "pr.tdd",
      name: "TDD",
      category: "engineering",
      level: "must",
      scope: [],
    });
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", category: "legal", level: "must" }).success).toBe(false);
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", category: "security", level: "may" }).success).toBe(false);
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", level: "must" }).success).toBe(false);
  });

  it("parses acceptance criteria on usecases", () => {
    const uc = UsecaseSchema.parse({ id: "uc.a", name: "A", acceptance: [{ id: "ac1", when: "押す", then: "保存される" }] });
    expect(uc.acceptance).toEqual([{ id: "ac1", when: "押す", then: "保存される" }]);
    expect(UsecaseSchema.parse({ id: "uc.b", name: "B" }).acceptance).toEqual([]);
    expect(AcceptanceSchema.safeParse({ id: "AC1", when: "w", then: "t" }).success).toBe(false);
    expect(AcceptanceSchema.safeParse({ id: "ac1", then: "t" }).success).toBe(false);
    expect(AcceptanceSchema.safeParse({ id: "ac1", when: "w", then: "t", extra: 1 }).success).toBe(false);
    expect(acceptanceRef("uc.a", "ac1")).toBe("uc.a#ac1");
  });
});
