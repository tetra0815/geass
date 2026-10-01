import { join } from "node:path";
import { currentBranch, gitConfig } from "./git.js";

export const REVIEWS_DIR = "docs/rdra/reviews";
export const DESIGN_REVIEWS_DIR = "docs/design/reviews";
export type Stage = "rdra" | "design";

export interface Feature {
  id: string;
  branch: string;
  reviewFile: string;
  designReviewFile: string;
}

export function stageReviewFile(feature: Feature, stage: Stage): string {
  return stage === "design" ? feature.designReviewFile : feature.reviewFile;
}

/** A branch with the feature prefix whose remainder is not a usable feature id. */
export interface InvalidFeature {
  invalid: true;
  branch: string;
  reason: string;
}

const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const isInvalidFeature = (f: Feature | InvalidFeature | null): f is InvalidFeature => f !== null && "invalid" in f;

function invalidReason(branch: string, prefix: string, id: string): string {
  const suggestion = id.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[^A-Za-z0-9]+/, "") || "001-name";
  return (
    `ブランチ ${branch} は feature ブランチ（${prefix}*）ですが、「${id}」は feature ID に使えません。` +
    `feature ID は英数字で始まり、英数字と . _ - だけからなり、/ を含められません。` +
    `ブランチ名を ${prefix}<id> の形に変更してください（例: git branch -m ${prefix}${suggestion}）`
  );
}

/**
 * The feature of the current branch: null outside the feature prefix (develop,
 * hotfix/*, detached HEAD), an InvalidFeature when the branch has the prefix
 * but no usable id — callers must refuse, not treat it as outside.
 */
export async function resolveFeature(repoRoot: string): Promise<Feature | InvalidFeature | null> {
  const branch = await currentBranch(repoRoot);
  if (!branch) return null;
  const prefix = (await gitConfig(repoRoot, "gitflow.prefix.feature")) ?? "feature/";
  if (!branch.startsWith(prefix)) return null;
  const id = branch.slice(prefix.length);
  if (!FEATURE_ID.test(id)) return { invalid: true, branch, reason: invalidReason(branch, prefix, id) };
  return {
    id,
    branch,
    reviewFile: join(repoRoot, REVIEWS_DIR, `${id}.json`),
    designReviewFile: join(repoRoot, DESIGN_REVIEWS_DIR, `${id}.json`),
  };
}
