import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { modelHash } from "../src/model/hash.js";
import { parseModel, readModelFiles } from "../src/model/io.js";
import { runTrace } from "../src/trace-run.js";
import { readMarker } from "../src/trace-state.js";
import { makeFeatureRepo, makeInvalidFeatureRepo, makeRepo, run } from "./helpers.js";
import { PLAN, rdraFiles, tracedFeatureRepo } from "./trace-fixture.js";

const T = "2026-09-28T10:00:00+09:00";

function capture() {
  const out: string[] = [];
  const io: CliIo = { out: (s) => void out.push(s), err: () => undefined };
  return { io, out, last: () => JSON.parse(out.join("").trim().split("\n").at(-1)!) };
}

describe("runTrace", () => {
  it("passes a plan that covers everything and records the marker", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    const outcome = await runTrace(repo, T);
    expect(outcome).toMatchObject({
      status: "ok",
      feature: "001-demo",
      plans: [planPath],
      report: { ok: true, uncovered: [], applicable: ["pr.tdd"], covered: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"] },
    });
    const marker = await readMarker(repo, "001-demo");
    expect(marker?.rdra_hash).toBe(modelHash(parseModel(await readModelFiles(repo))));
    expect(Object.keys(marker!.plans)).toEqual([planPath]);
    expect(marker?.traced_at).toBe(T);
  });

  it("fails on uncovered items and removes an earlier marker", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    expect((await runTrace(repo, T)).status).toBe("ok");
    await writeFile(join(repo, planPath), PLAN.replace("**Covers:** `uc.place-order#ac2`", ""));
    run(repo, "git", ["commit", "-q", "-am", "drop coverage"]);
    const outcome = await runTrace(repo, T);
    expect(outcome).toMatchObject({ status: "failed", report: { ok: false, uncovered: ["uc.place-order#ac2"] } });
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });

  it("reports why it cannot run", async () => {
    expect(await runTrace(await makeRepo(rdraFiles()), T)).toMatchObject({ status: "error", message: expect.stringContaining("feature") });
    expect(await runTrace(await makeFeatureRepo(rdraFiles()), T)).toMatchObject({ status: "error", message: expect.stringContaining("計画") });
    expect(await runTrace(await makeInvalidFeatureRepo(rdraFiles()), T)).toMatchObject({
      status: "error",
      message: expect.stringContaining("feature/<id>"),
    });
    const noBase = await makeRepo(rdraFiles());
    run(noBase, "git", ["checkout", "-q", "-b", "feature/x"]);
    expect(await runTrace(noBase, T)).toMatchObject({ status: "error", message: expect.stringContaining("基点") });
  });
});

describe("cli trace", () => {
  it("exits 0, 1 and 2 with a JSON last line", async () => {
    const ok = await tracedFeatureRepo();
    let c = capture();
    expect(await runCli(["trace", "--repo", ok.repo], c.io)).toBe(0);
    expect(c.last()).toMatchObject({ status: "ok", feature: "001-demo" });
    expect(c.out.join("")).toContain("適用される原則");

    const bad = await tracedFeatureRepo(PLAN.replace("Covers: uc.place-order#ac1, pr.audit", "Covers: uc.place-order#ac1, pr.nope"));
    c = capture();
    expect(await runCli(["trace", "--repo", bad.repo], c.io)).toBe(1);
    expect(c.last()).toMatchObject({ status: "failed", uncovered: ["pr.audit"], unknown: ["pr.nope"] });

    c = capture();
    expect(await runCli(["trace", "--repo", await makeRepo()], c.io)).toBe(2);
    expect(c.last().status).toBe("error");
  });
});
