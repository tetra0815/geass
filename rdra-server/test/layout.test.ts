import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT_DIR, readLayout, writeLayoutView } from "../src/layout.js";
import { modelHash } from "../src/model/hash.js";
import { RdraStore } from "../src/store.js";
import { makeRepo } from "./helpers.js";

describe("layout", () => {
  it("reads an empty layout for every view when nothing is stored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-layout-"));
    const layout = await readLayout(dir);
    expect(Object.keys(layout)).toEqual(["system-context", "business-flow", "usecase-composite", "information-model", "state-model"]);
    expect(layout["usecase-composite"]).toEqual({});
  });

  it("merges, rounds, sorts and drops invalid positions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-layout-"));
    await writeLayoutView(dir, "information-model", { "inf.b": { x: 10.4, y: 20.6 } });
    const merged = await writeLayoutView(dir, "information-model", {
      "inf.a": { x: 1, y: 2 },
      "inf.bad": { x: Number.NaN, y: 0 } as never,
    });
    expect(merged).toEqual({ "inf.a": { x: 1, y: 2 }, "inf.b": { x: 10, y: 21 } });
    expect(await readFile(join(dir, LAYOUT_DIR, "information-model.yaml"), "utf8")).toBe(
      "inf.a:\n  x: 1\n  y: 2\ninf.b:\n  x: 10\n  y: 21\n",
    );
    expect((await readLayout(dir))["information-model"]).toEqual(merged);
  });

  it("is written through the store without changing the model version", async () => {
    const repo = await makeRepo();
    const store = await RdraStore.open(repo);
    const events: string[] = [];
    store.on("layout", () => events.push("layout"));
    store.on("change", () => events.push("change"));
    await store.setLayout("state-model", { "st.order": { x: 5, y: 5 } });
    expect(store.version).toBe(modelHash(store.model));
    expect(events).toEqual(["layout"]);
    store.close();
  });
});
