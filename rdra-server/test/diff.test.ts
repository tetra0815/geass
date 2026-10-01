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

  it("reports acceptance criteria changes per criterion", () => {
    const before = sampleModel();
    before.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られる" },
      { id: "ac2", when: "取り消す", then: "取り消される" },
    ];
    const after = sampleModel();
    after.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られ、メールが届く" },
      { id: "ac3", when: "再注文する", then: "作られる" },
    ];
    const [change] = diffModels(before, after);
    expect(change).toMatchObject({ id: "uc.place-order", type: "modified", fields: ["acceptance"] });
    expect(change.acceptance).toEqual([
      { id: "ac1", type: "modified" },
      { id: "ac2", type: "removed" },
      { id: "ac3", type: "added" },
    ]);
  });

  it("reports every criterion of an added usecase as added and omits the field when nothing changed", () => {
    const after = sampleModel();
    after.usecases.push({
      id: "uc.cancel",
      name: "取り消す",
      actors: [],
      screens: [],
      events: [],
      information: [],
      transitions: [],
      acceptance: [{ id: "ac1", when: "取り消す", then: "取り消される" }],
    });
    const changes = diffModels(sampleModel(), after);
    expect(changes.find((c) => c.id === "uc.cancel")?.acceptance).toEqual([{ id: "ac1", type: "added" }]);
    const renamed = sampleModel();
    renamed.usecases[0].name = "注文を確定する";
    expect(diffModels(sampleModel(), renamed)[0]).not.toHaveProperty("acceptance");
  });
});
