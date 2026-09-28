import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { diffAgainstBase } from "./base-diff.js";
import { resolveFeature } from "./feature.js";
import { modelHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import type { Model } from "./model/kinds.js";
import { knownRefs, matchTrace, parseCovers, traceTargets, type TraceReport } from "./trace.js";
import { PLANS_DIR, featurePlans, planHashes, removeMarker, writeMarker } from "./trace-state.js";

export type TraceOutcome =
  | { status: "ok" | "failed"; feature: string; plans: string[]; report: TraceReport }
  | { status: "error"; message: string };

export async function runTrace(repoRoot: string, now: string): Promise<TraceOutcome> {
  const feature = await resolveFeature(repoRoot);
  if (!feature) return { status: "error", message: "feature ブランチ（feature/*）の外では trace できません" };
  let model: Model;
  let diff;
  try {
    model = parseModel(await readModelFiles(repoRoot));
    diff = await diffAgainstBase(repoRoot, model);
  } catch (e) {
    if (e instanceof ModelParseError) return { status: "error", message: `RDRA の YAML を読めません: ${e.message}` };
    throw e;
  }
  if (!diff.base) {
    return {
      status: "error",
      message: "差分の基点が見つかりません。develop ブランチ（または git config gitflow.branch.<branch>.base）を確認してください",
    };
  }
  const plans = await featurePlans(repoRoot, diff.base);
  if (plans.length === 0) {
    return {
      status: "error",
      message: `この feature で commit された計画（${PLANS_DIR}/*.md）がありません。計画を commit してから実行してください`,
    };
  }
  const covers: string[] = [];
  for (const p of plans) {
    for (const ref of parseCovers(await readFile(join(repoRoot, p), "utf8"))) if (!covers.includes(ref)) covers.push(ref);
  }
  const report = matchTrace(traceTargets(model, diff.changes), covers, knownRefs(model));
  if (report.ok) {
    await writeMarker(repoRoot, feature.id, { rdra_hash: modelHash(model), plans: await planHashes(repoRoot, plans), traced_at: now });
  } else {
    await removeMarker(repoRoot, feature.id);
  }
  return { status: report.ok ? "ok" : "failed", feature: feature.id, plans, report };
}

const list = (xs: string[]) => (xs.length ? xs.join(", ") : "なし");

export function formatTrace(outcome: TraceOutcome): string {
  if (outcome.status === "error") return `trace: 実行できません: ${outcome.message}\n`;
  const r = outcome.report;
  return [
    `trace: feature ${outcome.feature}、計画 ${outcome.plans.length} 件（${outcome.plans.join(", ")}）`,
    `結果: ${outcome.status === "ok" ? "OK" : "NG"}（カバー済み ${r.covered.length} / ${r.required.length}）`,
    `未カバー: ${list(r.uncovered)}`,
    `不明な参照: ${list(r.unknown)}`,
    `範囲外の参照（警告）: ${list(r.outOfScope)}`,
    `適用される原則（照合対象外）: ${list(r.applicable)}`,
    "",
  ].join("\n");
}
