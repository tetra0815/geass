import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RDRA_DIR } from "../src/model/io.js";
import { RdraStore, type StoreChange } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeRepo } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const stores: RdraStore[] = [];
async function openStore(repo: string) {
  const s = await RdraStore.open(repo);
  stores.push(s);
  return s;
}
afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

function nextChange(store: RdraStore, timeoutMs = 3000): Promise<StoreChange> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no change event")), timeoutMs);
    store.once("change", (c: StoreChange) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
}

describe("RdraStore", () => {
  it("opens an empty model without creating docs/rdra", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    store.watch();
    expect(store.model.usecases).toEqual([]);
    await expect(stat(join(repo, RDRA_DIR))).rejects.toThrow();
  });

  it("applies operations, writes YAML, bumps the version and emits change", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const before = store.version;
    const changed = nextChange(store);
    const result = await store.apply([{ op: "upsert", kind: "actors", element: { id: "act.customer", name: "顧客" } }]);
    expect(result.ok).toBe(true);
    expect(store.version).not.toBe(before);
    expect((await changed).version).toBe(store.version);
    expect(await readFile(join(repo, RDRA_DIR, "actors.yaml"), "utf8")).toBe("- id: act.customer\n  name: 顧客\n");
  });

  it("rejects stale versions", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const result = await store.apply([{ op: "upsert", kind: "actors", element: { id: "act.a", name: "A" } }], { expectedVersion: "sha256:old" });
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("rejects operations that introduce errors and leaves files untouched", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    const before = await readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8");
    const result = await store.apply([{ op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.ghost" }]);
    expect(result).toMatchObject({ ok: false, reason: "introduces-errors" });
    expect(await readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toBe(before);
  });

  it("reports invalid operations", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    expect(await store.apply([{ op: "delete", id: "act.none" }])).toMatchObject({ ok: false, reason: "invalid-operation" });
  });

  it("serializes concurrent applies", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.apply([{ op: "upsert", kind: "screens", element: { id: `scr.s${i}`, name: `S${i}` } }])),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.model.screens).toHaveLength(10);
  });

  it("keeps the last good model on YAML errors, blocks edits, and recovers", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    const good = store.version;
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: act.a\n  name: [\n");
    await store.reload();
    expect(store.parseError?.file).toBe("actors.yaml");
    expect(store.version).toBe(good);
    expect(await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.x", name: "X" } }])).toMatchObject({
      ok: false,
      reason: "parse-error",
    });
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), sampleFiles()["actors.yaml"]);
    await store.reload();
    expect(store.parseError).toBeNull();
  });

  it("reloads when files change on disk", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    store.watch();
    await new Promise((r) => setTimeout(r, 200));
    const changed = nextChange(store);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.top\n  name: トップ\n");
    await changed;
    expect(store.model.screens.map((s) => s.id)).toEqual(["scr.top"]);
  });
});
