import { resolve, sep } from "node:path";
import { checkFeatureApproval } from "./approval.js";
import { resolveBaseCommit } from "./git.js";
import { modelHash } from "./model/hash.js";
import { featurePlans, planHashes, readMarker, samePlans } from "./trace-state.js";

export type GateDecision = { decision: "allow" } | { decision: "deny"; reason: string };

const PLAN_SKILLS = new Set(["writing-plans"]);
const EXECUTION_SKILLS = new Set(["executing-plans", "subagent-driven-development"]);
export const GATED_SKILLS: ReadonlySet<string> = new Set([...PLAN_SKILLS, ...EXECUTION_SKILLS]);

const allow: GateDecision = { decision: "allow" };
const deny = (reason: string): GateDecision => ({ decision: "deny", reason });

export async function gateSkill(repoRoot: string, skill: string): Promise<GateDecision> {
  const name = skill.split(":").at(-1) ?? skill;
  if (!GATED_SKILLS.has(name)) return allow;
  const approval = await checkFeatureApproval(repoRoot);
  if (approval.state === "outside") return allow;
  if (approval.state !== "approved") {
    const changed = approval.changed?.length ? ` 変更された要素: ${approval.changed.join(", ")}` : "";
    return deny(approval.message + changed);
  }
  if (!EXECUTION_SKILLS.has(name)) return allow;

  const marker = await readMarker(repoRoot, approval.featureId!);
  if (!marker) return deny("/trace がまだ通っていません。計画を commit し、/trace で RDRA の差分をすべてカバーしていることを確認してください。");
  if (marker.rdra_hash !== modelHash(approval.model!)) return deny("/trace の後に RDRA が変更されました。/trace を再実行してください。");
  const base = await resolveBaseCommit(repoRoot);
  const plans = base ? await featurePlans(repoRoot, base) : [];
  if (!samePlans(marker.plans, await planHashes(repoRoot, plans))) {
    return deny("/trace の後に計画が変更されました。計画を commit し、/trace を再実行してください。");
  }
  return allow;
}

export function gatePath(file: string): GateDecision {
  const normalized = resolve(file).split(sep).join("/");
  if (normalized.includes("/docs/rdra/reviews/")) {
    return deny("承認記録（docs/rdra/reviews/）はレビュー画面からのみ更新できます。承認・差し戻しは人間がレビュー画面で行ってください。");
  }
  return allow;
}
