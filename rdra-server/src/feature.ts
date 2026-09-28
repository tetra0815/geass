import { join } from "node:path";
import { currentBranch, gitConfig } from "./git.js";

export const REVIEWS_DIR = "docs/rdra/reviews";

export interface Feature {
  id: string;
  branch: string;
  reviewFile: string;
}

const FEATURE_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export async function resolveFeature(repoRoot: string): Promise<Feature | null> {
  const branch = await currentBranch(repoRoot);
  if (!branch) return null;
  const prefix = (await gitConfig(repoRoot, "gitflow.prefix.feature")) ?? "feature/";
  if (!branch.startsWith(prefix)) return null;
  const id = branch.slice(prefix.length);
  if (!FEATURE_ID.test(id)) return null;
  return { id, branch, reviewFile: join(repoRoot, REVIEWS_DIR, `${id}.json`) };
}
