import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkDesignApproval, checkFeatureApproval, designRequired } from "../src/approval.js";
import { diffModels } from "../src/diff.js";
import { isInvalidFeature, resolveFeature, type Feature } from "../src/feature.js";
import { modelHash, rdraHash } from "../src/model/hash.js";
import { DESIGN_DIR, RDRA_DIR, parseModel, readModelFiles } from "../src/model/io.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { sampleDesignFiles, sampleFullModel, sampleModel } from "./fixtures.js";
import { makeFeatureRepo, makeRepo, run, writeFiles } from "./helpers.js";
import { rdraFiles } from "./trace-fixture.js";

const T = "2026-10-01T10:00:00+09:00";
const designRepoFiles = () => Object.fromEntries(Object.entries(sampleDesignFiles()).map(([f, c]) => [`docs/${f}`, c]));
const current = async (repo: string) => parseModel(await readModelFiles(repo));

async function featureOf(repo: string): Promise<Feature> {
  const feature = await resolveFeature(repo);
  if (!feature || isInvalidFeature(feature)) throw new Error("not a feature branch");
  return feature;
}

async function approve(file: string, hash: string) {
  await writeReview(file, decide(requestReview(emptyReview(), { now: T }), { decision: "approved", comments: [], hash, now: T }));
}

describe("designRequired", () => {
  it("is required when the design layer changed or the design does not realize the RDRA change", () => {
    const base = sampleFullModel();
    expect(designRequired(base, [])).toBe(false);
    const renamed = sampleFullModel();
    renamed.screens[0].name = "カート画面";
    expect(designRequired(renamed, diffModels(base, renamed))).toBe(false);
    const tech = sampleFullModel();
    tech.components[0].tech = "Next.js 17";
    expect(designRequired(tech, diffModels(base, tech))).toBe(true);
    const info = sampleModel();
    info.information[0].attributes.push("合計金額");
    expect(designRequired(info, diffModels(sampleModel(), info))).toBe(true);
  });
});

describe("checkDesignApproval", () => {
  it("is not required for a feature without design work", async () => {
    const repo = await makeFeatureRepo({ ...rdraFiles(), ...designRepoFiles() });
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.cart\n  name: カート画面\n");
    expect(await checkDesignApproval(repo, await featureOf(repo), await current(repo))).toMatchObject({ state: "not-required", required: false });
  });

  it("asks for a review of design changes, accepts the approval, and goes stale on any later change", async () => {
    const repo = await makeFeatureRepo({ ...rdraFiles(), ...designRepoFiles() });
    await writeFile(join(repo, DESIGN_DIR, "tables.yaml"), sampleDesignFiles()["design/tables.yaml"].replace("order_id (uuid)", "order_no"));
    const feature = await featureOf(repo);
    const none = await checkDesignApproval(repo, feature, await current(repo));
    expect(none).toMatchObject({ state: "none", required: true });
    expect(none.message).toContain("/design");

    await approve(feature.designReviewFile, modelHash(await current(repo)));
    expect((await checkDesignApproval(repo, feature, await current(repo))).state).toBe("approved");

    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve design"]);
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: act.customer\n  name: 会員\n");
    const stale = await checkDesignApproval(repo, feature, await current(repo));
    expect(stale).toMatchObject({ state: "stale", changed: ["modified act.customer"] });
    expect(stale.message).toContain("/design で再レビュー");
  });

  it("keeps an open review in force even when the design is not required", async () => {
    const repo = await makeFeatureRepo({ ...rdraFiles(), ...designRepoFiles() });
    const feature = await featureOf(repo);
    await writeReview(feature.designReviewFile, requestReview(emptyReview(), { now: T }));
    expect(await checkDesignApproval(repo, feature, await current(repo))).toMatchObject({ state: "pending", required: false });
  });

  it("cannot decide without a diff base", async () => {
    const repo = await makeRepo(rdraFiles());
    run(repo, "git", ["checkout", "-q", "-b", "feature/001-demo"]);
    const result = await checkDesignApproval(repo, await featureOf(repo), await current(repo));
    expect(result.state).toBe("error");
    expect(result.message).toContain("差分の基点が見つかりません");
  });
});

describe("checkFeatureApproval", () => {
  it("returns the feature and names only RDRA changes when the RDRA approval is stale", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const feature = await featureOf(repo);
    await approve(feature.reviewFile, rdraHash(await current(repo)));
    expect((await checkFeatureApproval(repo)).feature).toEqual(feature);
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve"]);
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: act.customer\n  name: 会員\n");
    await writeFiles(repo, { [`${DESIGN_DIR}/components.yaml`]: "- id: comp.db\n  name: DB\n  type: datastore\n" });
    expect(await checkFeatureApproval(repo)).toMatchObject({ state: "stale", changed: ["modified act.customer"] });
  });
});
