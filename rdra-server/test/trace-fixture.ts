import { RDRA_DIR } from "../src/model/io.js";
import { PLANS_DIR } from "../src/trace-state.js";
import { sampleFiles } from "./fixtures.js";
import { makeFeatureRepo, run, writeFiles } from "./helpers.js";

export const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));

export const PLAN = [
  "# 注文の計画",
  "### Task 1: 注文",
  "Covers: uc.place-order#ac1, pr.audit",
  "- [ ] テストを書く",
  "### Task 2: 取り消し",
  "**Covers:** `uc.place-order#ac2`",
  "- [ ] テストを書く",
  "",
].join("\n");

/** A feature branch that changed uc.place-order (two criteria) and added pr.audit (scoped to it) and pr.tdd, with a committed plan covering all of it. */
export async function tracedFeatureRepo(plan = PLAN): Promise<{ repo: string; planPath: string }> {
  const repo = await makeFeatureRepo(rdraFiles());
  const planPath = `${PLANS_DIR}/2026-09-28-order.md`;
  await writeFiles(repo, {
    [`${RDRA_DIR}/usecases.yaml`]:
      sampleFiles()["usecases.yaml"] +
      "  acceptance:\n    - { id: ac1, when: 注文する, then: 作られる }\n    - { id: ac2, when: 取り消す, then: 取り消される }\n",
    [`${RDRA_DIR}/principles.yaml`]: [
      "- id: pr.audit",
      "  name: 監査ログ",
      "  description: 全更新を記録する",
      "  category: security",
      "  level: must",
      "  scope: [uc.place-order]",
      "- id: pr.tdd",
      "  name: TDD",
      "  description: テストから書く",
      "  category: engineering",
      "  level: must",
      "",
    ].join("\n"),
    [planPath]: plan,
  });
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", "feature work"]);
  return { repo, planPath };
}
