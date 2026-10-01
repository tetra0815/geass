import { diffModels, type ElementChange } from "./diff.js";
import { readModelFilesAt, resolveBaseCommit } from "./git.js";
import { parseModel } from "./model/io.js";
import type { Model } from "./model/kinds.js";

export const NO_BASE_MESSAGE =
  "差分の基点が見つかりません。develop ブランチ（または git config gitflow.branch.<branch>.base）を確認してください";

export interface BaseDiff {
  base: string | null;
  changes: ElementChange[];
}

export async function diffAgainstBase(repoRoot: string, model: Model): Promise<BaseDiff> {
  const base = await resolveBaseCommit(repoRoot);
  if (!base) return { base: null, changes: [] };
  const baseModel = parseModel(await readModelFilesAt(repoRoot, base));
  return { base, changes: diffModels(baseModel, model) };
}
