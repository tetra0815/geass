import { relative } from "node:path";
import { diffModels } from "./diff.js";
import { isInvalidFeature, resolveFeature } from "./feature.js";
import { lastCommitTouching, readModelFilesAt } from "./git.js";
import { modelHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import type { Model } from "./model/kinds.js";
import { approvalState, readReview } from "./review.js";

export const APPROVAL_MESSAGES = {
  none: "RDRA のレビューがまだ依頼されていません。/rdra でモデルを作成し、レビューを完了してください。",
  pending: "RDRA のレビューが承認待ちです。レビュー画面で承認してください。",
  rejected: "RDRA が差し戻されています。/rdra でコメントに対応し、再度レビューを依頼してください。",
  stale: "承認後に RDRA が変更されました。/rdra で再レビューを受けてください。",
  approved: "RDRA は承認済みです。",
  outside: "feature ブランチ（feature/*）の外です。",
} as const;

export interface ApprovalResult {
  state: "approved" | "none" | "pending" | "rejected" | "stale" | "outside" | "error";
  message: string;
  changed?: string[];
  model?: Model;
  featureId?: string;
}

async function changedSinceApproval(repo: string, reviewFile: string, current: Model): Promise<string[] | undefined> {
  const commit = await lastCommitTouching(repo, relative(repo, reviewFile));
  if (!commit) return undefined;
  try {
    return diffModels(parseModel(await readModelFilesAt(repo, commit)), current).map((c) => `${c.type} ${c.id}`);
  } catch {
    return undefined;
  }
}

export async function checkFeatureApproval(repo: string): Promise<ApprovalResult> {
  const feature = await resolveFeature(repo);
  if (!feature) return { state: "outside", message: APPROVAL_MESSAGES.outside };
  if (isInvalidFeature(feature)) return { state: "error", message: feature.reason };
  let model: Model;
  try {
    model = parseModel(await readModelFiles(repo));
  } catch (e) {
    if (!(e instanceof ModelParseError)) throw e;
    return { state: "error", message: `RDRA の YAML を読めません: ${e.message}`, featureId: feature.id };
  }
  let review;
  try {
    review = await readReview(feature.reviewFile);
  } catch (e) {
    return { state: "error", message: `承認記録を読めません: ${(e as Error).message}`, featureId: feature.id };
  }
  const state = approvalState(review, modelHash(model));
  const result: ApprovalResult = { state: state.state, message: APPROVAL_MESSAGES[state.state], model, featureId: feature.id };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, feature.reviewFile, model);
    if (changed) result.changed = changed;
  }
  return result;
}
