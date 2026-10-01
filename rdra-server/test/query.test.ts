import { describe, expect, it } from "vitest";
import { QueryIndex } from "../src/query.js";
import { sampleModel } from "./fixtures.js";

describe("QueryIndex", () => {
  it("answers relation queries", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    const rows = index.query(
      "SELECT r.from_id, json_extract(r.attrs, '$.access') AS access FROM relations r WHERE r.to_id = 'inf.order' AND r.kind = 'uc.information'",
    );
    expect(rows).toEqual([{ from_id: "uc.place-order", access: "create" }]);
  });

  it("exposes one view per kind and the state tables", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    expect(index.query("SELECT id, name FROM usecases")).toEqual([{ id: "uc.place-order", name: "注文する" }]);
    expect(index.query("SELECT count(*) AS n FROM state_nodes")).toEqual([{ n: 2 }]);
    expect(index.query("SELECT ref FROM state_transitions")).toEqual([{ ref: "st.order:draft->placed" }]);
  });

  it("rejects writes", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    expect(() => index.query("DELETE FROM elements")).toThrow();
    expect(index.query("SELECT count(*) AS n FROM elements")).toEqual([{ n: 8 }]);
  });

  it("replaces previous content on rebuild", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    const m = sampleModel();
    m.screens = [];
    index.rebuild(m);
    expect(index.query("SELECT count(*) AS n FROM screens")).toEqual([{ n: 0 }]);
  });

  it("indexes principles, their scope and acceptance criteria", () => {
    const m = sampleModel();
    m.principles.push({ id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] });
    m.usecases[0].acceptance.push({ id: "ac1", given: "在庫あり", when: "注文する", then: "作られる" });
    const index = new QueryIndex();
    index.rebuild(m);
    expect(index.query("SELECT id FROM principles")).toEqual([{ id: "pr.audit" }]);
    expect(index.query("SELECT principle_id, target_id FROM principle_scope")).toEqual([
      { principle_id: "pr.audit", target_id: "uc.place-order" },
    ]);
    expect(index.query("SELECT usecase_id, ac_id, ref, given_text, when_text, then_text FROM acceptance")).toEqual([
      { usecase_id: "uc.place-order", ac_id: "ac1", ref: "uc.place-order#ac1", given_text: "在庫あり", when_text: "注文する", then_text: "作られる" },
    ]);
  });
});
