import { describe, expect, it } from "vitest";
import { modelHash } from "../src/model/hash.js";
import { parseModel } from "../src/model/io.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

describe("modelHash", () => {
  it("has the sha256 prefix", () => {
    expect(modelHash(sampleModel())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("ignores key order, whitespace and comments", () => {
    const files = sampleFiles();
    files["actors.yaml"] = "# people\n-   name: 顧客\n    id: act.customer\n\n";
    expect(modelHash(parseModel(files))).toBe(modelHash(sampleModel()));
  });

  it("ignores element order within a file", () => {
    const a = parseModel({ "screens.yaml": "- id: scr.a\n  name: A\n- id: scr.b\n  name: B\n" });
    const b = parseModel({ "screens.yaml": "- id: scr.b\n  name: B\n- id: scr.a\n  name: A\n" });
    expect(modelHash(a)).toBe(modelHash(b));
  });

  it("treats an omitted relation list like an empty one", () => {
    const a = parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n" });
    const b = parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n  actors: []\n" });
    expect(modelHash(a)).toBe(modelHash(b));
  });

  it("changes when meaning changes", () => {
    const files = sampleFiles();
    files["actors.yaml"] = "- id: act.customer\n  name: 会員\n";
    expect(modelHash(parseModel(files))).not.toBe(modelHash(sampleModel()));
  });
});
