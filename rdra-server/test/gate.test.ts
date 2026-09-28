import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { resolveFeature } from "../src/feature.js";
import { gatePath, gateSkill } from "../src/gate.js";
import { modelHash } from "../src/model/hash.js";
import { RDRA_DIR, parseModel, readModelFiles } from "../src/model/io.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { runTrace } from "../src/trace-run.js";
import { makeRepo, run } from "./helpers.js";
import { rdraFiles, tracedFeatureRepo } from "./trace-fixture.js";

const T = "2026-09-28T10:00:00+09:00";

async function approve(repo: string) {
  const feature = (await resolveFeature(repo))!;
  const hash = modelHash(parseModel(await readModelFiles(repo)));
  await writeReview(feature.reviewFile, decide(requestReview(emptyReview(), { now: T }), { decision: "approved", comments: [], hash, now: T }));
}

const reason = (d: { decision: string; reason?: string }) => (d.decision === "deny" ? d.reason : "");

describe("gateSkill", () => {
  it("allows skills it does not gate and anything outside a feature", async () => {
    const { repo } = await tracedFeatureRepo();
    expect(await gateSkill(repo, "superpowers:brainstorming")).toEqual({ decision: "allow" });
    expect(await gateSkill(await makeRepo(rdraFiles()), "superpowers:executing-plans")).toEqual({ decision: "allow" });
  });

  it("requires an approved, unchanged RDRA model for writing-plans", async () => {
    const { repo } = await tracedFeatureRepo();
    expect(reason(await gateSkill(repo, "superpowers:writing-plans"))).toContain("レビューがまだ依頼されていません");
    await approve(repo);
    expect(await gateSkill(repo, "writing-plans")).toEqual({ decision: "allow" });
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve"]);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.cart\n  name: カート画面\n");
    const stale = reason(await gateSkill(repo, "superpowers:writing-plans"));
    expect(stale).toContain("再レビュー");
    expect(stale).toContain("modified scr.cart");
  });

  it("requires a current trace marker for execution skills", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    await approve(repo);
    expect(reason(await gateSkill(repo, "superpowers:subagent-driven-development"))).toContain("/trace");
    expect((await runTrace(repo, T)).status).toBe("ok");
    expect(await gateSkill(repo, "superpowers:subagent-driven-development")).toEqual({ decision: "allow" });
    expect(await gateSkill(repo, "executing-plans")).toEqual({ decision: "allow" });

    // Ticking checkboxes during execution keeps the marker valid.
    const plan = join(repo, planPath);
    await writeFile(plan, (await readFile(plan, "utf8")).replace("- [ ] テストを書く", "- [x] テストを書く"));
    expect(await gateSkill(repo, "superpowers:executing-plans")).toEqual({ decision: "allow" });

    await writeFile(plan, (await readFile(plan, "utf8")) + "\n### Task 3\nCovers: pr.audit\n");
    expect(reason(await gateSkill(repo, "superpowers:executing-plans"))).toContain("計画が変更されました");
  });

  it("denies when the model cannot be read", async () => {
    const { repo } = await tracedFeatureRepo();
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: [\n");
    expect(reason(await gateSkill(repo, "superpowers:writing-plans"))).toContain("YAML");
  });
});

describe("gatePath", () => {
  it("denies review records anywhere and allows other files", () => {
    expect(gatePath("/work/repo/docs/rdra/reviews/42-x.json").decision).toBe("deny");
    expect(gatePath("/work/repo/.claude/worktrees/feature/42-x/docs/rdra/reviews/42-x.json").decision).toBe("deny");
    expect(gatePath("/work/repo/docs/rdra/usecases.yaml")).toEqual({ decision: "allow" });
    expect(gatePath("/work/repo/docs/rdra/reviews-notes.md")).toEqual({ decision: "allow" });
  });
});

describe("cli gate", () => {
  it("prints one JSON line and exits 0 / 1 / 64", async () => {
    const { repo } = await tracedFeatureRepo();
    const out: string[] = [];
    const io: CliIo = { out: (s) => void out.push(s), err: () => undefined };
    expect(await runCli(["gate", "--repo", repo, "--skill", "superpowers:writing-plans"], io)).toBe(1);
    expect(JSON.parse(out.pop()!)).toMatchObject({ decision: "deny" });
    expect(await runCli(["gate", "--repo", repo, "--skill", "superpowers:brainstorming"], io)).toBe(0);
    expect(JSON.parse(out.pop()!)).toEqual({ decision: "allow" });
    expect(await runCli(["gate", "--repo", repo, "--path", join(repo, "docs/rdra/reviews/001-demo.json")], io)).toBe(1);
    expect(await runCli(["gate", "--repo", repo], io)).toBe(64);
  });
});
