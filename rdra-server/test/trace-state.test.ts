import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANS_DIR,
  featurePlans,
  markerPath,
  normalizePlan,
  planHashes,
  readMarker,
  removeMarker,
  samePlans,
  writeMarker,
} from "../src/trace-state.js";
import { makeFeatureRepo, makeRepo, run, writeFiles } from "./helpers.js";

const head = (repo: string) => run(repo, "git", ["rev-parse", "HEAD"]).trim();

async function commit(repo: string, files: Record<string, string>) {
  await writeFiles(repo, files);
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", "c"]);
}

describe("featurePlans", () => {
  it("lists plans added or changed since the base, including non-ASCII names, and skips deleted ones", async () => {
    const repo = await makeFeatureRepo({ [`${PLANS_DIR}/old.md`]: "old", [`${PLANS_DIR}/gone.md`]: "gone" });
    const base = head(repo);
    await commit(repo, {
      [`${PLANS_DIR}/2026-09-28-注文取消.md`]: "# 計画",
      [`${PLANS_DIR}/old.md`]: "old, edited",
      [`${PLANS_DIR}/notes.txt`]: "not a plan",
      "docs/other.md": "not in the plans dir",
    });
    run(repo, "git", ["rm", "-q", `${PLANS_DIR}/gone.md`]);
    run(repo, "git", ["commit", "-q", "-m", "rm"]);
    expect(await featurePlans(repo, base)).toEqual([`${PLANS_DIR}/2026-09-28-注文取消.md`, `${PLANS_DIR}/old.md`]);
  });

  it("ignores plans that are only uncommitted", async () => {
    const repo = await makeFeatureRepo();
    await writeFiles(repo, { [`${PLANS_DIR}/draft.md`]: "draft" });
    expect(await featurePlans(repo, head(repo))).toEqual([]);
  });
});

describe("plan hashes", () => {
  it("ignores checkbox state but not other edits", async () => {
    expect(normalizePlan("- [x] a\n  - [X] b\n* [ ] c\n[x] not a list")).toBe("- [ ] a\n  - [ ] b\n* [ ] c\n[x] not a list");
    expect(normalizePlan("+ [x] a\n1. [x] b\n  12) [X] c\n1.[x] no space\n1x [x] not ordered")).toBe(
      "+ [ ] a\n1. [ ] b\n  12) [ ] c\n1.[x] no space\n1x [x] not ordered",
    );
    const repo = await makeFeatureRepo();
    const path = `${PLANS_DIR}/p.md`;
    await writeFiles(repo, { [path]: "- [ ] step\nCovers: pr.a\n" });
    const before = await planHashes(repo, [path]);
    expect(before[path]).toMatch(/^sha256:[0-9a-f]{64}$/);
    await writeFile(join(repo, path), "- [x] step\nCovers: pr.a\n");
    expect(samePlans(before, await planHashes(repo, [path]))).toBe(true);
    await writeFile(join(repo, path), "- [x] step\nCovers: pr.b\n");
    expect(samePlans(before, await planHashes(repo, [path]))).toBe(false);
  });

  it("compares plan sets by path as well as content", () => {
    expect(samePlans({ a: "1" }, { a: "1" })).toBe(true);
    expect(samePlans({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(samePlans({ a: "1", b: "2" }, { a: "1" })).toBe(false);
  });
});

describe("marker", () => {
  it("writes, reads and removes the marker and keeps the state dir out of git", async () => {
    const repo = await makeFeatureRepo();
    expect(await readMarker(repo, "001-demo")).toBeNull();
    const marker = { design_hash: "sha256:1", plans: { "docs/superpowers/plans/p.md": "sha256:2" }, traced_at: "t" };
    await writeMarker(repo, "001-demo", marker);
    expect(markerPath(repo, "001-demo")).toBe(join(repo, ".geass", "state", "trace-001-demo.json"));
    expect(await readMarker(repo, "001-demo")).toEqual(marker);
    expect(await readFile(join(repo, ".geass", "state", ".gitignore"), "utf8")).toBe("*\n");
    expect(run(repo, "git", ["status", "--porcelain"]).trim()).toBe("");
    await removeMarker(repo, "001-demo");
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });

  it("treats a corrupted marker as missing", async () => {
    const repo = await makeFeatureRepo();
    await writeFiles(repo, { ".geass/state/trace-001-demo.json": "{ nope" });
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });

  it("treats a marker from 0.12.0 as missing", async () => {
    const repo = await makeRepo();
    await mkdir(join(repo, ".geass", "state"), { recursive: true });
    await writeFile(markerPath(repo, "001-demo"), JSON.stringify({ rdra_hash: "sha256:1", plans: {}, traced_at: "t" }));
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });
});
