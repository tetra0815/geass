import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { currentBranch } from "./git.js";

const FEATURE_BRANCH = /^(\d{8}-\d{6}-[a-z0-9-]+|\d{3}-[a-z0-9-]+)$/;

export async function resolveFeatureDir(repoRoot: string, env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const absolute = (p: string) => (isAbsolute(p) ? p : join(repoRoot, p));
  if (env.SPECIFY_FEATURE_DIRECTORY) return absolute(env.SPECIFY_FEATURE_DIRECTORY);
  try {
    const data = JSON.parse(await readFile(join(repoRoot, ".geass", "feature.json"), "utf8")) as { feature_directory?: unknown };
    if (typeof data.feature_directory === "string" && data.feature_directory) return absolute(data.feature_directory);
  } catch {
    // missing or unreadable feature.json: fall through to the branch name
  }
  const branch = await currentBranch(repoRoot);
  if (branch && FEATURE_BRANCH.test(branch)) return join(repoRoot, "specs", branch);
  return null;
}
