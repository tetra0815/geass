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
});
