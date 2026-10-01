import { relative } from "node:path";
import { NO_BASE_MESSAGE, diffAgainstBase } from "./base-diff.js";
import { diffModels, type ElementChange } from "./diff.js";
import { isInvalidFeature, resolveFeature, type Feature } from "./feature.js";
import { lastCommitTouching, readModelFilesAt } from "./git.js";
import { modelHash, rdraHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import { kindDef, type Layer, type Model } from "./model/kinds.js";
import { approvalState, readReview } from "./review.js";
import { hasErrors, validateDesignChanges } from "./validate.js";

export const APPROVAL_MESSAGES = {
  none: "RDRA のレビューがまだ依頼されていません。/rdra でモデルを作成し、レビューを完了してください。",
  pending: "RDRA のレビューが承認待ちです。レビュー画面で承認してください。",
  rejected: "RDRA が差し戻されています。/rdra でコメントに対応し、再度レビューを依頼してください。",
  stale: "承認後に RDRA が変更されました。/rdra で再レビューを受けてください。",
  approved: "RDRA は承認済みです。",
  outside: "feature ブランチ（feature/*）の外です。",
} as const;

export const DESIGN_APPROVAL_MESSAGES = {
  none: "設計のレビューがまだ依頼されていません。/design で設計モデルを作成し、レビューを完了してください。",
  pending: "設計のレビューが承認待ちです。レビュー画面で承認してください。",
  rejected: "設計が差し戻されています。/design でコメントに対応し、再度レビューを依頼してください。",
  stale: "承認後に RDRA または設計が変更されました。/design で再レビューを受けてください。",
  approved: "設計は承認済みです。",
  "not-required": "この feature には設計の変更がないため、設計の承認は不要です。",
} as const;

export interface ApprovalResult {
  state: "approved" | "none" | "pending" | "rejected" | "stale" | "outside" | "error";
  message: string;
  changed?: string[];
  model?: Model;
  featureId?: string;
  feature?: Feature;
}

async function changedSinceApproval(repo: string, reviewFile: string, current: Model, layer?: Layer): Promise<string[] | undefined> {
  const commit = await lastCommitTouching(repo, relative(repo, reviewFile));
  if (!commit) return undefined;
  try {
    return diffModels(parseModel(await readModelFilesAt(repo, commit)), current)
      .filter((c) => !layer || kindDef(c.kind).layer === layer)
      .map((c) => `${c.type} ${c.id}`);
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
  const state = approvalState(review, rdraHash(model));
  const result: ApprovalResult = { state: state.state, message: APPROVAL_MESSAGES[state.state], model, featureId: feature.id, feature };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, feature.reviewFile, model, "rdra");
    if (changed) result.changed = changed;
  }
  return result;
}

/** Whether this feature needs its design approved: it changed the design, or the design does not yet realize its RDRA change. */
export function designRequired(model: Model, changes: ElementChange[]): boolean {
  return changes.some((c) => kindDef(c.kind).layer === "design") || hasErrors(validateDesignChanges(model, changes));
}

export interface DesignApprovalResult {
  state: "approved" | "not-required" | "none" | "pending" | "rejected" | "stale" | "error";
  message: string;
  required: boolean;
  changed?: string[];
}

/** The design stage of a feature. Callers check the RDRA stage first. */
export async function checkDesignApproval(repo: string, feature: Feature, model: Model): Promise<DesignApprovalResult> {
  let review;
  try {
    review = await readReview(feature.designReviewFile);
  } catch (e) {
    return { state: "error", message: `設計の承認記録を読めません: ${(e as Error).message}`, required: true };
  }
  const state = approvalState(review, modelHash(model));
  if (state.state === "approved") return { state: "approved", message: DESIGN_APPROVAL_MESSAGES.approved, required: true };

  let diff;
  try {
    diff = await diffAgainstBase(repo, model);
  } catch (e) {
    if (!(e instanceof ModelParseError)) throw e;
    return { state: "error", message: `分岐点のモデルを読めません: ${e.message}`, required: true };
  }
  if (!diff.base) return { state: "error", message: NO_BASE_MESSAGE, required: true };
  const required = designRequired(model, diff.changes);
  // An open review stays in force: a human is looking at it.
  if (!required && state.state !== "pending") {
    return { state: "not-required", message: DESIGN_APPROVAL_MESSAGES["not-required"], required };
  }
  const result: DesignApprovalResult = { state: state.state, message: DESIGN_APPROVAL_MESSAGES[state.state], required };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, feature.designReviewFile, model);
    if (changed) result.changed = changed;
  }
  return result;
}
