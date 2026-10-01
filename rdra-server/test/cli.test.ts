import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { REVIEWS_DIR } from "../src/feature.js";
import { modelHash, rdraHash } from "../src/model/hash.js";
import { RDRA_DIR } from "../src/model/io.js";
import { nodeVersionError } from "../src/node-version.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { sampleDesignFiles, sampleFiles, sampleFullModel, sampleModel } from "./fixtures.js";
import { makeFeatureRepo, makeInvalidFeatureRepo, makeRepo, run } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const T = "2026-09-25T10:00:00+09:00";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (s) => void out.push(s), err: (s) => void err.push(s), sleep: async () => {} };
  return { io, out, err };
}

async function check(repo: string) {
  const c = capture();
  const code = await runCli(["check-approval", "--repo", repo], c.io);
  return { code, result: JSON.parse(c.out.join("")) };
}

describe("nodeVersionError", () => {
  it("accepts 22.13 and later", () => {
    expect(nodeVersionError("22.13.0")).toBeNull();
    expect(nodeVersionError("24.4.0")).toBeNull();
    expect(nodeVersionError("22.12.1")).toContain("Node 22.13 以上");
    expect(nodeVersionError("20.19.0")).toContain("現在: 20.19.0");
  });
});

describe("check-approval", () => {
  it("reports none, pending, rejected, approved and stale", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const file = join(repo, REVIEWS_DIR, "001-demo.json");
    expect(await check(repo)).toMatchObject({ code: 1, result: { state: "none" } });

    let rec = requestReview(emptyReview(), { now: T });
    await writeReview(file, rec);
    expect(await check(repo)).toMatchObject({ code: 1, result: { state: "pending" } });

    await writeReview(file, decide(rec, { decision: "rejected", comments: [{ target: null, text: "x" }], hash: "h", now: T }));
    expect(await check(repo)).toMatchObject({ code: 1, result: { state: "rejected" } });

    rec = decide(rec, { decision: "approved", comments: [], hash: rdraHash(sampleModel()), now: T });
    await writeReview(file, rec);
    expect(await check(repo)).toMatchObject({ code: 0, result: { state: "approved" } });

    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve"]);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.cart\n  name: カート画面\n");
    const stale = await check(repo);
    expect(stale).toMatchObject({ code: 1, result: { state: "stale", changed: ["modified scr.cart"] } });
    expect(stale.result.message).toContain("再レビュー");
  });

  it("exits 2 outside a feature branch", async () => {
    const repo = await makeRepo(rdraFiles());
    expect(await check(repo)).toMatchObject({ code: 2, result: { state: "outside" } });
  });

  it("exits 3 with an explanation on an invalid feature branch", async () => {
    const repo = await makeInvalidFeatureRepo(rdraFiles());
    expect(await check(repo)).toMatchObject({ code: 3, result: { state: "error", message: expect.stringContaining("feature/<id>") } });
  });

  it("exits 3 on YAML errors", async () => {
    const repo = await makeFeatureRepo({ [`${RDRA_DIR}/actors.yaml`]: "- id: [\n" });
    expect(await check(repo)).toMatchObject({ code: 3, result: { state: "error" } });
  });

  it("exits 3 on corrupted review file", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    await mkdir(join(repo, REVIEWS_DIR), { recursive: true });
    await writeFile(join(repo, REVIEWS_DIR, "001-demo.json"), "{ not json");
    const result = await check(repo);
    expect(result.code).toBe(3);
    expect(result.result.state).toBe("error");
    expect(result.result.message).toContain("承認記録を読めません");
  });
});

describe("wait-review", () => {
  it("exits 2 when nothing is pending", async () => {
    const repo = await makeFeatureRepo();
    const c = capture();
    expect(await runCli(["wait-review", "--repo", repo], c.io)).toBe(2);
  });

  it("returns when the review is decided", async () => {
    const repo = await makeFeatureRepo();
    const file = join(repo, REVIEWS_DIR, "001-demo.json");
    const pending = requestReview(emptyReview(), { now: T });
    await writeReview(file, pending);
    let polls = 0;
    const c = capture();
    c.io.sleep = async () => {
      polls += 1;
      if (polls === 3) {
        await writeReview(file, decide(pending, { decision: "rejected", comments: [{ target: "uc.a", text: "直して" }], hash: "h", now: T }));
      }
    };
    expect(await runCli(["wait-review", "--repo", repo], c.io)).toBe(0);
    expect(JSON.parse(c.out.join(""))).toMatchObject({ status: "rejected", lastRound: { comments: [{ text: "直して" }] } });
  });

  it("times out with 124", async () => {
    const repo = await makeFeatureRepo();
    const file = join(repo, REVIEWS_DIR, "001-demo.json");
    await writeReview(file, requestReview(emptyReview(), { now: T }));
    const c = capture();
    c.io.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    expect(await runCli(["wait-review", "--repo", repo, "--interval-ms", "10", "--timeout-sec", "0.05"], c.io)).toBe(124);
  });

  it("exits 3 on corrupted review file", async () => {
    const repo = await makeFeatureRepo();
    await mkdir(join(repo, REVIEWS_DIR), { recursive: true });
    await writeFile(join(repo, REVIEWS_DIR, "001-demo.json"), "{ not json");
    const c = capture();
    const code = await runCli(["wait-review", "--repo", repo], c.io);
    expect(code).toBe(3);
    const result = JSON.parse(c.out.join(""));
    expect(result.state).toBe("error");
    expect(result.message).toContain("承認記録を読めません");
  });

  it("exits 3 outside a feature branch", async () => {
    const c = capture();
    expect(await runCli(["wait-review", "--repo", await makeRepo()], c.io)).toBe(3);
  });

  it("exits 3 with an explanation on an invalid feature branch", async () => {
    const c = capture();
    expect(await runCli(["wait-review", "--repo", await makeInvalidFeatureRepo()], c.io)).toBe(3);
    expect(JSON.parse(c.out.join(""))).toMatchObject({ state: "error", message: expect.stringContaining("feature/<id>") });
  });
});

describe("usage", () => {
  it("prints the design hash with --stage design", async () => {
    const repo = await makeRepo({
      ...rdraFiles(),
      ...Object.fromEntries(Object.entries(sampleDesignFiles()).map(([f, c]) => [`docs/${f}`, c])),
    });
    const rdra = capture();
    expect(await runCli(["hash", "--repo", repo], rdra.io)).toBe(0);
    expect(rdra.out.join("").trim()).toBe(rdraHash(sampleModel()));
    const design = capture();
    expect(await runCli(["hash", "--repo", repo, "--stage", "design"], design.io)).toBe(0);
    expect(design.out.join("").trim()).toBe(modelHash(sampleFullModel()));
    expect(await runCli(["hash", "--repo", repo, "--stage", "nope"], capture().io)).toBe(64);
  });

  it("prints the hash and rejects unknown commands", async () => {
    const repo = await makeRepo(rdraFiles());
    const c = capture();
    expect(await runCli(["hash", "--repo", repo], c.io)).toBe(0);
    expect(c.out.join("").trim()).toBe(rdraHash(sampleModel()));
    expect(await runCli(["nope"], capture().io)).toBe(64);
    expect(await runCli(["check-approval"], capture().io)).toBe(64);
  });

  it("hash exits 3 on YAML errors", async () => {
    const repo = await makeRepo({ [`${RDRA_DIR}/actors.yaml`]: "- id: [\n" });
    const c = capture();
    const code = await runCli(["hash", "--repo", repo], c.io);
    expect(code).toBe(3);
    expect(c.err.join("")).toContain("YAML");
  });
});
