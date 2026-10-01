import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelParseError,
  DESIGN_DIR,
  RDRA_DIR,
  parseModel,
  readModelFiles,
  serializeModel,
  writeModelFiles,
} from "../src/model/io.js";
import { sampleDesignFiles, sampleFiles, sampleModel } from "./fixtures.js";

describe("parseModel", () => {
  it("parses every kind", () => {
    const m = sampleModel();
    expect(m.usecases[0].information).toEqual([{ ref: "inf.order", access: "create" }]);
    expect(m.states[0].transitions).toEqual([{ from: "draft", to: "placed" }]);
    expect(m.events[0].target).toBe("ext.payment-gateway");
  });

  it("treats missing and empty files as empty lists", () => {
    const m = parseModel({ "actors.yaml": "", "screens.yaml": "[]\n" });
    expect(m.actors).toEqual([]);
    expect(m.screens).toEqual([]);
    expect(m.usecases).toEqual([]);
  });

  it("reports YAML syntax errors with file and line", () => {
    const err = (() => {
      try {
        parseModel({ "actors.yaml": "- id: act.a\n  name: [\n" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ModelParseError);
    expect((err as ModelParseError).file).toBe("actors.yaml");
    expect((err as ModelParseError).line).toBeGreaterThan(0);
  });

  it("reports schema errors with the item path and line", () => {
    const err = (() => {
      try {
        parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n- id: bad id\n  name: B\n" });
      } catch (e) {
        return e;
      }
    })() as ModelParseError;
    expect(err).toBeInstanceOf(ModelParseError);
    expect(err.line).toBe(3);
    expect(err.detail).toContain("[1.id]");
  });

  it("rejects a file whose top level is not a list", () => {
    expect(() => parseModel({ "actors.yaml": "id: act.a\n" })).toThrow(ModelParseError);
  });

  it("names the design file in errors", () => {
    expect(() => parseModel({ "design/tables.yaml": "- id: tbl.x\n  name: X\n" })).toThrow(/^design\/tables\.yaml:1: /);
  });
});

describe("serializeModel", () => {
  it("round-trips the sample model", () => {
    const m = sampleModel();
    expect(parseModel(serializeModel(m))).toEqual(m);
  });

  it("omits empty relation arrays and writes empty kinds as []", () => {
    const files = serializeModel(parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n" }));
    expect(files["usecases.yaml"]).toBe("- id: uc.a\n  name: A\n");
    expect(files["actors.yaml"]).toBe("[]\n");
    expect(Object.keys(files)).toHaveLength(12);
  });

  it("round-trips principles and acceptance criteria", () => {
    const files = sampleFiles();
    files["usecases.yaml"] += "  acceptance:\n    - { id: ac1, when: 注文する, then: 作られる }\n";
    files["principles.yaml"] = "- id: pr.tdd\n  name: TDD\n  category: engineering\n  level: must\n";
    const model = parseModel(files);
    expect(parseModel(serializeModel(model))).toEqual(model);
    expect(serializeModel(model)["principles.yaml"]).toContain("category: engineering");
  });
});

describe("file io", () => {
  it("reads nothing from a repo without docs/rdra", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    expect(await readModelFiles(dir)).toEqual({});
  });

  it("writes only changed files and creates the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    const files = serializeModel(sampleModel());
    const written = await writeModelFiles(dir, files, {});
    expect(written).toHaveLength(9);
    expect((await readdir(join(dir, RDRA_DIR))).sort()).toHaveLength(9);

    const changed = { ...files, "screens.yaml": "- id: scr.top\n  name: トップ\n" };
    expect(await writeModelFiles(dir, changed, files)).toEqual(["screens.yaml"]);
    expect(await readFile(join(dir, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.top");
    const onDisk = Object.fromEntries(Object.entries(changed).filter(([key]) => !key.startsWith("design/")));
    expect(await readModelFiles(dir)).toEqual(onDisk);
  });

  it("reads files that exist on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    await mkdir(join(dir, RDRA_DIR), { recursive: true });
    await writeFile(join(dir, RDRA_DIR, "actors.yaml"), sampleFiles()["actors.yaml"]);
    expect(await readModelFiles(dir)).toEqual({ "actors.yaml": sampleFiles()["actors.yaml"] });
  });

  it("reads and writes design kinds under docs/design", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    const model = parseModel({ ...sampleFiles(), ...sampleDesignFiles() });
    const files = serializeModel(model);
    expect(Object.keys(files)).toContain("design/tables.yaml");
    await writeModelFiles(dir, files, {});
    expect(await readFile(join(dir, DESIGN_DIR, "tables.yaml"), "utf8")).toContain("tbl.orders");
    expect((await readdir(join(dir, RDRA_DIR))).sort()).toHaveLength(9);
    expect(parseModel(await readModelFiles(dir))).toEqual(model);
  });

  it("does not create empty design files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    const files = serializeModel(sampleModel());
    expect(files["design/components.yaml"]).toBe("[]\n");
    await writeModelFiles(dir, files, {});
    await expect(readdir(join(dir, DESIGN_DIR))).rejects.toThrow();
  });
});
