import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { emptyModel } from "../src/model/kinds.js";
import { parseModel } from "../src/model/io.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

describe("diffModels", () => {
  it("reports nothing for identical models", () => {
    expect(diffModels(sampleModel(), sampleModel())).toEqual([]);
  });

  it("reports everything as added against an empty base", () => {
    const changes = diffModels(emptyModel(), sampleModel());
    expect(changes).toHaveLength(8);
    expect(changes.every((c) => c.type === "added" && c.after && !c.before)).toBe(true);
  });

  it("reports modified fields, including relation changes", () => {
    const files = sampleFiles();
    files["usecases.yaml"] = files["usecases.yaml"]
      .replace("name: 注文する", "name: 注文を確定する")
      .replace("access: create", "access: update");
    const changes = diffModels(sampleModel(), parseModel(files));
    expect(changes).toEqual([
      expect.objectContaining({ id: "uc.place-order", kind: "usecases", type: "modified", fields: ["information", "name"] }),
    ]);
  });

  it("reports removed elements", () => {
    const files = sampleFiles();
    files["screens.yaml"] = "[]\n";
    const changes = diffModels(sampleModel(), parseModel(files));
    expect(changes).toContainEqual(expect.objectContaining({ id: "scr.cart", type: "removed", fields: [] }));
  });
});
