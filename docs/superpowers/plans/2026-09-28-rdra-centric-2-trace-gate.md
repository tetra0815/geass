# RDRA 中心パイプライン 計画 2: trace と gate の CLI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 計画が RDRA の差分（受け入れ条件と MUST 原則）をすべてカバーしているかを決定的に照合する `cli.js trace` と、実行前ゲートの判定をまとめた `cli.js gate` を rdra-server に追加する。

**Architecture:** 照合は純粋関数（`src/trace.ts`）で、git やファイルとのやり取り（計画ファイルの特定、ハッシュ、マーカー）は `src/trace-state.ts` に分ける。承認状態の判定は `src/approval.ts` に切り出し、`check-approval` と `gate` で共有する。Python のフック（計画 3）は `gate` を呼ぶだけになる。

**Tech Stack:** TypeScript（Node 22.13+）、vitest

**Spec:** `docs/superpowers/specs/2026-09-28-rdra-centric-pipeline-design.md`（§5、§6）

**前提:** 計画 1 が完了していること（`resolveFeature`、`REVIEWS_DIR`、`Principle`、`acceptanceRef`、`ElementChange`、`makeFeatureRepo` を使う）

## Global Constraints

- 作業ディレクトリは `rdra-server/`
- 計画ファイル: 差分の基点から HEAD までに追加・変更（rename を含む）され、作業ツリーに存在する `docs/superpowers/plans/*.md`
- `Covers:` の参照形式: `uc.<slug>#<ac id>`（受け入れ条件）と `pr.<slug>`（原則）
- カバーすべき項目: 差分で追加・変更されたユースケースの全受け入れ条件、差分で追加・変更された MUST 原則、差分で追加・変更されたユースケースを `scope` に含む MUST 原則
- 照合の対象外: `scope` が空で `category` が `engineering` / `technology` の原則（「適用される原則」として報告するだけ）
- マーカー: `.geass/state/trace-<feature ID>.json` = `{ "rdra_hash", "plans": { "<path>": "<sha256>" }, "traced_at" }`
- `trace` の終了コード: 成功 `0`、照合の失敗 `1`、実行できない `2`
- `gate` の終了コード: 許可 `0`、拒否 `1`、引数の誤り `64`
- ゲート対象のスキル: `writing-plans`（承認済みが条件）、`executing-plans` / `subagent-driven-development`（承認済み＋trace マーカーが現在と一致が条件）。名前空間付き（`superpowers:writing-plans`）も同じ扱い
- `docs/rdra/reviews/` 配下のファイルは、feature ブランチかどうかに関係なく編集を拒否する

## Review Focus

- **実行中にチェックボックスが `- [x]` に変わった計画**: 計画の中身が変わったとはみなさず、マーカーを無効にしない（セッションをまたいで実行を再開できる） → Task 2 のテストで固定する
- **日本語などの非 ASCII 文字を含む計画ファイル名**: git の quotePath でパスが化けずに見つかる → Task 2 のテストで固定する
- **コードブロックの中に書かれた `Covers:`**（計画の例示など）: 照合に数えない → Task 1 のテストで固定する
- **`**Covers:** \`uc.a#ac1\`` のように太字・バッククォート付きで書かれた行**: 通常の行と同じく読み取る → Task 1 のテストで固定する
- **照合が一度通った後に失敗した場合**: 古いマーカーを残さない（残すと、後で計画を元に戻したときに古い結果で通ってしまう） → Task 3 のテストで固定する

---

### Task 1: 照合の純粋関数 `src/trace.ts`

**Files:**
- Create: `rdra-server/src/trace.ts`
- Test: `rdra-server/test/trace.test.ts`

**Interfaces:**
- Consumes: `Model`、`Principle`、`acceptanceRef`、`KINDS`（`src/model/kinds.ts`）、`ElementChange`（`src/diff.ts`）
- Produces:
  - `export interface TraceTargets { required: string[]; applicable: string[] }`（どちらもソート済み）
  - `export function traceTargets(model: Model, changes: ElementChange[]): TraceTargets`
  - `export function knownRefs(model: Model): Set<string>`（全要素の id と全受け入れ条件の参照）
  - `export function parseCovers(markdown: string): string[]`（出現順、重複なし）
  - `export interface TraceReport { ok: boolean; required: string[]; applicable: string[]; covered: string[]; uncovered: string[]; unknown: string[]; outOfScope: string[] }`
  - `export function matchTrace(targets: TraceTargets, covers: string[], known: Set<string>): TraceReport`

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/trace.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import type { Model } from "../src/model/kinds.js";
import { knownRefs, matchTrace, parseCovers, traceTargets } from "../src/trace.js";
import { sampleModel } from "./fixtures.js";

function baseModel(): Model {
  const m = sampleModel();
  m.usecases.push({
    id: "uc.browse",
    name: "商品を見る",
    actors: [],
    screens: [],
    events: [],
    information: [],
    transitions: [],
    acceptance: [{ id: "ac1", when: "開く", then: "一覧が出る" }],
  });
  m.principles.push(
    { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
    { id: "pr.fast", name: "速い", category: "quality", level: "should", scope: ["uc.place-order"] },
    { id: "pr.tdd", name: "TDD", category: "engineering", level: "must", scope: [] },
    { id: "pr.pii", name: "個人情報は国内", category: "security", level: "must", scope: [] },
  );
  return m;
}

describe("traceTargets", () => {
  it("requires every criterion of changed usecases and must principles scoped to them", () => {
    const base = baseModel();
    const head = baseModel();
    head.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られる" },
      { id: "ac2", when: "取り消す", then: "取り消される" },
    ];
    expect(traceTargets(head, diffModels(base, head))).toEqual({
      required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"],
      applicable: ["pr.tdd"],
    });
  });

  it("requires changed must principles even without a changed usecase, but never engineering or technology ones without scope", () => {
    const base = baseModel();
    const head = baseModel();
    head.principles.find((p) => p.id === "pr.pii")!.description = "国内リージョンのみ";
    head.principles.find((p) => p.id === "pr.tdd")!.description = "テストから書く";
    head.principles.push({ id: "pr.stack", name: "TypeScript", category: "technology", level: "must", scope: [] });
    expect(traceTargets(head, diffModels(base, head))).toEqual({ required: ["pr.pii"], applicable: ["pr.stack", "pr.tdd"] });
  });

  it("ignores removed usecases and should principles", () => {
    const base = baseModel();
    const head = baseModel();
    head.usecases = head.usecases.filter((u) => u.id !== "uc.browse");
    head.principles.find((p) => p.id === "pr.fast")!.name = "もっと速い";
    expect(traceTargets(head, diffModels(base, head)).required).toEqual([]);
  });
});

describe("parseCovers", () => {
  it("reads plain, bulleted, bold and backticked Covers lines, skipping code fences", () => {
    const plan = [
      "### Task 1",
      "Covers: uc.place-order#ac1, pr.audit",
      "- Covers: uc.place-order#ac2",
      "**Covers:** `uc.browse#ac1`、`pr.pii`",
      "**Covers**: pr.audit",
      "```markdown",
      "Covers: uc.example#ac9",
      "```",
      "covers: uc.lowercase#ac1",
      "Not a Covers: line",
    ].join("\n");
    expect(parseCovers(plan)).toEqual(["uc.place-order#ac1", "pr.audit", "uc.place-order#ac2", "uc.browse#ac1", "pr.pii"]);
  });
});

describe("matchTrace", () => {
  it("classifies covered, uncovered, unknown and out-of-scope references", () => {
    const model = baseModel();
    const report = matchTrace(
      { required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"], applicable: ["pr.tdd"] },
      ["uc.place-order#ac1", "pr.audit", "uc.browse#ac1", "uc.place-order#ac9", "pr.nope"],
      knownRefs(model),
    );
    expect(report).toEqual({
      ok: false,
      required: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"],
      applicable: ["pr.tdd"],
      covered: ["pr.audit", "uc.place-order#ac1"],
      uncovered: ["uc.place-order#ac2"],
      unknown: ["pr.nope", "uc.place-order#ac9"],
      outOfScope: ["uc.browse#ac1"],
    });
  });

  it("passes when everything is covered, even with out-of-scope references", () => {
    const report = matchTrace({ required: ["pr.audit"], applicable: [] }, ["pr.audit", "uc.browse#ac1"], knownRefs(baseModel()));
    expect(report.ok).toBe(true);
    expect(report.outOfScope).toEqual(["uc.browse#ac1"]);
  });

  it("knows element ids and acceptance references", () => {
    const known = knownRefs(baseModel());
    expect(known.has("uc.browse#ac1")).toBe(true);
    expect(known.has("pr.tdd")).toBe(true);
    expect(known.has("scr.cart")).toBe(true);
    expect(known.has("uc.browse#ac2")).toBe(false);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/trace.test.ts`
Expected: FAIL（`../src/trace.js` がない）

- [ ] **Step 3: `src/trace.ts` を実装する**

```ts
import type { ElementChange } from "./diff.js";
import { KINDS, acceptanceRef, type AnyElement, type KindKey, type Model, type Principle } from "./model/kinds.js";

export interface TraceTargets {
  required: string[];
  applicable: string[];
}

export interface TraceReport {
  ok: boolean;
  required: string[];
  applicable: string[];
  covered: string[];
  uncovered: string[];
  unknown: string[];
  outOfScope: string[];
}

// Process and stack rules apply to every feature; tying them to individual
// tasks would only produce a "Covers: pr.tdd" line on every task.
const NOT_TRACED: readonly Principle["category"][] = ["engineering", "technology"];

function liveChanges(changes: ElementChange[], kind: KindKey): Set<string> {
  return new Set(changes.filter((c) => c.kind === kind && c.type !== "removed").map((c) => c.id));
}

export function traceTargets(model: Model, changes: ElementChange[]): TraceTargets {
  const usecases = liveChanges(changes, "usecases");
  const principles = liveChanges(changes, "principles");
  const required = new Set<string>();
  const applicable = new Set<string>();
  for (const uc of model.usecases) {
    if (!usecases.has(uc.id)) continue;
    for (const ac of uc.acceptance) required.add(acceptanceRef(uc.id, ac.id));
  }
  for (const p of model.principles) {
    if (p.level !== "must") continue;
    if (p.scope.length === 0 && NOT_TRACED.includes(p.category)) {
      applicable.add(p.id);
      continue;
    }
    if (principles.has(p.id) || p.scope.some((id) => usecases.has(id))) required.add(p.id);
  }
  return { required: [...required].sort(), applicable: [...applicable].sort() };
}

export function knownRefs(model: Model): Set<string> {
  const known = new Set<string>();
  for (const kind of KINDS) for (const e of model[kind.key] as AnyElement[]) known.add(e.id);
  for (const uc of model.usecases) for (const ac of uc.acceptance) known.add(acceptanceRef(uc.id, ac.id));
  return known;
}

const COVERS_LINE = /^\s*(?:[-*]\s+)?(?:\*\*)?Covers(?:\*\*)?:(?:\*\*)?\s*(.*)$/;
const FENCE = /^\s*(```|~~~)/;

export function parseCovers(markdown: string): string[] {
  const refs: string[] = [];
  let inFence = false;
  for (const line of markdown.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = COVERS_LINE.exec(line);
    if (!m) continue;
    for (const token of m[1].split(/[\s,、]+/)) {
      const ref = token.replace(/^[`*]+/, "").replace(/[`*.;]+$/, "");
      if (ref && !refs.includes(ref)) refs.push(ref);
    }
  }
  return refs;
}

export function matchTrace(targets: TraceTargets, covers: string[], known: Set<string>): TraceReport {
  const required = new Set(targets.required);
  const given = new Set(covers);
  const covered = targets.required.filter((r) => given.has(r));
  const uncovered = targets.required.filter((r) => !given.has(r));
  const unknown = covers.filter((r) => !known.has(r)).sort();
  const outOfScope = covers.filter((r) => known.has(r) && !required.has(r)).sort();
  return {
    ok: uncovered.length === 0 && unknown.length === 0,
    required: targets.required,
    applicable: targets.applicable,
    covered,
    uncovered,
    unknown,
    outOfScope,
  };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run test/trace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/trace.ts test/trace.test.ts
git commit -m "Add pure trace matching between RDRA changes and plan Covers lines"
```

---

### Task 2: 計画ファイルの特定・ハッシュ・マーカー `src/trace-state.ts`

**Files:**
- Create: `rdra-server/src/trace-state.ts`
- Test: `rdra-server/test/trace-state.test.ts`

**Interfaces:**
- Consumes: `git(cwd, args)`（`src/git.ts`）
- Produces:
  - `export const PLANS_DIR = "docs/superpowers/plans"`
  - `export async function featurePlans(repoRoot: string, base: string): Promise<string[]>`（リポジトリ相対パス、ソート済み）
  - `export function normalizePlan(text: string): string`（チェックボックスの `[x]` / `[X]` を `[ ]` にそろえる）
  - `export async function planHashes(repoRoot: string, paths: string[]): Promise<Record<string, string>>`（値は `sha256:<hex>`）
  - `export interface TraceMarker { rdra_hash: string; plans: Record<string, string>; traced_at: string }`
  - `export function markerPath(repoRoot: string, featureId: string): string`
  - `export async function writeMarker(repoRoot: string, featureId: string, marker: TraceMarker): Promise<void>`（`.geass/state/.gitignore` に `*` を置く）
  - `export async function readMarker(repoRoot: string, featureId: string): Promise<TraceMarker | null>`（存在しない・壊れている場合は `null`）
  - `export async function removeMarker(repoRoot: string, featureId: string): Promise<void>`
  - `export function samePlans(a: Record<string, string>, b: Record<string, string>): boolean`

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/trace-state.test.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PLANS_DIR,
  featurePlans,
  markerPath,
  normalizePlan,
  planHashes,
  readMarker,
  removeMarker,
  samePlans,
  writeMarker,
} from "../src/trace-state.js";
import { makeFeatureRepo, run, writeFiles } from "./helpers.js";

const head = (repo: string) => run(repo, "git", ["rev-parse", "HEAD"]).trim();

async function commit(repo: string, files: Record<string, string>) {
  await writeFiles(repo, files);
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", "c"]);
}

describe("featurePlans", () => {
  it("lists plans added or changed since the base, including non-ASCII names, and skips deleted ones", async () => {
    const repo = await makeFeatureRepo({ [`${PLANS_DIR}/old.md`]: "old", [`${PLANS_DIR}/gone.md`]: "gone" });
    const base = head(repo);
    await commit(repo, {
      [`${PLANS_DIR}/2026-09-28-注文取消.md`]: "# 計画",
      [`${PLANS_DIR}/old.md`]: "old, edited",
      [`${PLANS_DIR}/notes.txt`]: "not a plan",
      "docs/other.md": "not in the plans dir",
    });
    run(repo, "git", ["rm", "-q", `${PLANS_DIR}/gone.md`]);
    run(repo, "git", ["commit", "-q", "-m", "rm"]);
    expect(await featurePlans(repo, base)).toEqual([`${PLANS_DIR}/2026-09-28-注文取消.md`, `${PLANS_DIR}/old.md`]);
  });

  it("ignores plans that are only uncommitted", async () => {
    const repo = await makeFeatureRepo();
    await writeFiles(repo, { [`${PLANS_DIR}/draft.md`]: "draft" });
    expect(await featurePlans(repo, head(repo))).toEqual([]);
  });
});

describe("plan hashes", () => {
  it("ignores checkbox state but not other edits", async () => {
    expect(normalizePlan("- [x] a\n  - [X] b\n* [ ] c\n[x] not a list")).toBe("- [ ] a\n  - [ ] b\n* [ ] c\n[x] not a list");
    const repo = await makeFeatureRepo();
    const path = `${PLANS_DIR}/p.md`;
    await writeFiles(repo, { [path]: "- [ ] step\nCovers: pr.a\n" });
    const before = await planHashes(repo, [path]);
    expect(before[path]).toMatch(/^sha256:[0-9a-f]{64}$/);
    await writeFile(join(repo, path), "- [x] step\nCovers: pr.a\n");
    expect(samePlans(before, await planHashes(repo, [path]))).toBe(true);
    await writeFile(join(repo, path), "- [x] step\nCovers: pr.b\n");
    expect(samePlans(before, await planHashes(repo, [path]))).toBe(false);
  });

  it("compares plan sets by path as well as content", () => {
    expect(samePlans({ a: "1" }, { a: "1" })).toBe(true);
    expect(samePlans({ a: "1" }, { a: "1", b: "2" })).toBe(false);
    expect(samePlans({ a: "1", b: "2" }, { a: "1" })).toBe(false);
  });
});

describe("marker", () => {
  it("writes, reads and removes the marker and keeps the state dir out of git", async () => {
    const repo = await makeFeatureRepo();
    expect(await readMarker(repo, "001-demo")).toBeNull();
    const marker = { rdra_hash: "sha256:1", plans: { "docs/superpowers/plans/p.md": "sha256:2" }, traced_at: "t" };
    await writeMarker(repo, "001-demo", marker);
    expect(markerPath(repo, "001-demo")).toBe(join(repo, ".geass", "state", "trace-001-demo.json"));
    expect(await readMarker(repo, "001-demo")).toEqual(marker);
    expect(await readFile(join(repo, ".geass", "state", ".gitignore"), "utf8")).toBe("*\n");
    expect(run(repo, "git", ["status", "--porcelain"]).trim()).toBe("");
    await removeMarker(repo, "001-demo");
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });

  it("treats a corrupted marker as missing", async () => {
    const repo = await makeFeatureRepo();
    await writeFiles(repo, { ".geass/state/trace-001-demo.json": "{ nope" });
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/trace-state.test.ts`
Expected: FAIL（`../src/trace-state.js` がない）

- [ ] **Step 3: `src/trace-state.ts` を実装する**

```ts
import { createHash, randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git } from "./git.js";

export const PLANS_DIR = "docs/superpowers/plans";

export interface TraceMarker {
  rdra_hash: string;
  plans: Record<string, string>;
  traced_at: string;
}

export async function featurePlans(repoRoot: string, base: string): Promise<string[]> {
  // -z keeps non-ASCII paths verbatim instead of core.quotePath's escapes.
  const r = await git(repoRoot, ["diff", "-z", "--name-only", "--diff-filter=AMR", `${base}..HEAD`, "--", PLANS_DIR]);
  if (!r.ok) return [];
  return r.stdout
    .split("\0")
    .filter((p) => p.endsWith(".md") && existsSync(join(repoRoot, p)))
    .sort();
}

export function normalizePlan(text: string): string {
  // Executors tick checkboxes as they go; that is progress, not a change to
  // what the plan covers.
  return text.replace(/^(\s*[-*]\s+)\[[xX]\]/gm, "$1[ ]");
}

export async function planHashes(repoRoot: string, paths: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const p of paths) {
    const text = await readFile(join(repoRoot, p), "utf8");
    out[p] = "sha256:" + createHash("sha256").update(normalizePlan(text)).digest("hex");
  }
  return out;
}

export function samePlans(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => b[k] === a[k]);
}

export function markerPath(repoRoot: string, featureId: string): string {
  return join(repoRoot, ".geass", "state", `trace-${featureId}.json`);
}

export async function writeMarker(repoRoot: string, featureId: string, marker: TraceMarker): Promise<void> {
  const file = markerPath(repoRoot, featureId);
  await mkdir(dirname(file), { recursive: true });
  const ignore = join(dirname(file), ".gitignore");
  if (!existsSync(ignore)) await writeFile(ignore, "*\n", "utf8");
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, JSON.stringify(marker, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function readMarker(repoRoot: string, featureId: string): Promise<TraceMarker | null> {
  try {
    const data = JSON.parse(await readFile(markerPath(repoRoot, featureId), "utf8")) as Partial<TraceMarker>;
    if (typeof data.rdra_hash !== "string" || !data.plans || typeof data.plans !== "object") return null;
    return { rdra_hash: data.rdra_hash, plans: data.plans, traced_at: String(data.traced_at ?? "") };
  } catch {
    return null;
  }
}

export async function removeMarker(repoRoot: string, featureId: string): Promise<void> {
  await rm(markerPath(repoRoot, featureId), { force: true });
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run test/trace-state.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/trace-state.ts test/trace-state.test.ts
git commit -m "Find feature plans, hash them and persist the trace marker"
```

---

### Task 3: `cli.js trace`

**Files:**
- Create: `rdra-server/src/trace-run.ts`
- Modify: `rdra-server/src/cli.ts`
- Create: `rdra-server/test/trace-fixture.ts`
- Test: `rdra-server/test/trace-run.test.ts`

**Interfaces:**
- Consumes: Task 1 の `traceTargets` / `parseCovers` / `knownRefs` / `matchTrace`、Task 2 の `featurePlans` / `planHashes` / `writeMarker` / `removeMarker`、`resolveFeature`、`diffAgainstBase`（`src/base-diff.ts`）、`modelHash`、`parseModel` / `readModelFiles` / `ModelParseError`
- Produces:
  - `export type TraceOutcome = { status: "ok" | "failed"; feature: string; plans: string[]; report: TraceReport } | { status: "error"; message: string }`
  - `export async function runTrace(repoRoot: string, now: string): Promise<TraceOutcome>`
  - CLI: `cli.js trace --repo <root>`。人間向けの要約を複数行出力した後、最終行に JSON（`{ status, feature, plans, …report }` または `{ status: "error", message }`）を出す
  - `test/trace-fixture.ts`: `export async function tracedFeatureRepo(): Promise<{ repo: string; planPath: string }>`（計画 2 の Task 4 と計画 3 のテストでも使う）

- [ ] **Step 1: テスト用の fixture を書く**

`rdra-server/test/trace-fixture.ts`:

```ts
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
```

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/trace-run.test.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { modelHash } from "../src/model/hash.js";
import { parseModel, readModelFiles } from "../src/model/io.js";
import { runTrace } from "../src/trace-run.js";
import { readMarker } from "../src/trace-state.js";
import { makeFeatureRepo, makeRepo, run } from "./helpers.js";
import { PLAN, rdraFiles, tracedFeatureRepo } from "./trace-fixture.js";

const T = "2026-09-28T10:00:00+09:00";

function capture() {
  const out: string[] = [];
  const io: CliIo = { out: (s) => void out.push(s), err: () => undefined };
  return { io, out, last: () => JSON.parse(out.join("").trim().split("\n").at(-1)!) };
}

describe("runTrace", () => {
  it("passes a plan that covers everything and records the marker", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    const outcome = await runTrace(repo, T);
    expect(outcome).toMatchObject({
      status: "ok",
      feature: "001-demo",
      plans: [planPath],
      report: { ok: true, uncovered: [], applicable: ["pr.tdd"], covered: ["pr.audit", "uc.place-order#ac1", "uc.place-order#ac2"] },
    });
    const marker = await readMarker(repo, "001-demo");
    expect(marker?.rdra_hash).toBe(modelHash(parseModel(await readModelFiles(repo))));
    expect(Object.keys(marker!.plans)).toEqual([planPath]);
    expect(marker?.traced_at).toBe(T);
  });

  it("fails on uncovered items and removes an earlier marker", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    expect((await runTrace(repo, T)).status).toBe("ok");
    await writeFile(join(repo, planPath), PLAN.replace("**Covers:** `uc.place-order#ac2`", ""));
    run(repo, "git", ["commit", "-q", "-am", "drop coverage"]);
    const outcome = await runTrace(repo, T);
    expect(outcome).toMatchObject({ status: "failed", report: { ok: false, uncovered: ["uc.place-order#ac2"] } });
    expect(await readMarker(repo, "001-demo")).toBeNull();
  });

  it("reports why it cannot run", async () => {
    expect(await runTrace(await makeRepo(rdraFiles()), T)).toMatchObject({ status: "error", message: expect.stringContaining("feature") });
    expect(await runTrace(await makeFeatureRepo(rdraFiles()), T)).toMatchObject({ status: "error", message: expect.stringContaining("計画") });
    const noBase = await makeRepo(rdraFiles());
    run(noBase, "git", ["checkout", "-q", "-b", "feature/x"]);
    expect(await runTrace(noBase, T)).toMatchObject({ status: "error", message: expect.stringContaining("基点") });
  });
});

describe("cli trace", () => {
  it("exits 0, 1 and 2 with a JSON last line", async () => {
    const ok = await tracedFeatureRepo();
    let c = capture();
    expect(await runCli(["trace", "--repo", ok.repo], c.io)).toBe(0);
    expect(c.last()).toMatchObject({ status: "ok", feature: "001-demo" });
    expect(c.out.join("")).toContain("適用される原則");

    const bad = await tracedFeatureRepo(PLAN.replace("Covers: uc.place-order#ac1, pr.audit", "Covers: uc.place-order#ac1, pr.nope"));
    c = capture();
    expect(await runCli(["trace", "--repo", bad.repo], c.io)).toBe(1);
    expect(c.last()).toMatchObject({ status: "failed", uncovered: ["pr.audit"], unknown: ["pr.nope"] });

    c = capture();
    expect(await runCli(["trace", "--repo", await makeRepo()], c.io)).toBe(2);
    expect(c.last().status).toBe("error");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run test/trace-run.test.ts`
Expected: FAIL（`../src/trace-run.js` がない）

- [ ] **Step 4: `src/trace-run.ts` を実装する**

```ts
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
```

- [ ] **Step 5: `src/cli.ts` に `trace` を追加する**

- import に `import { formatTrace, runTrace } from "./trace-run.js";` を追加する
- `USAGE` の `hash` の行の前に `"  cli.js trace --repo <root>",` を追加する
- `runCli` の `if (command === "serve" …` の前に追加:

```ts
  if (command === "trace" && repo) {
    const outcome = await runTrace(repo, new Date().toISOString());
    io.out(formatTrace(outcome));
    const payload = outcome.status === "error" ? outcome : { status: outcome.status, feature: outcome.feature, plans: outcome.plans, ...outcome.report };
    io.out(JSON.stringify(payload) + "\n");
    return outcome.status === "ok" ? 0 : outcome.status === "failed" ? 1 : 2;
  }
```

- [ ] **Step 6: テストを実行する**

Run: `npm run typecheck && npx vitest run test/trace-run.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/trace-run.ts src/cli.ts test/trace-fixture.ts test/trace-run.test.ts
git commit -m "Add cli.js trace to check plan coverage of the feature's RDRA changes"
```

---

### Task 4: 承認判定の共通化と `cli.js gate`

**Files:**
- Create: `rdra-server/src/approval.ts`
- Create: `rdra-server/src/gate.ts`
- Modify: `rdra-server/src/cli.ts`（`check-approval` を `approval.ts` に委譲、`gate` を追加）
- Test: `rdra-server/test/gate.test.ts`

**Interfaces:**
- Consumes: `resolveFeature`、`readReview`、`approvalState`、`lastCommitTouching`、`readModelFilesAt`、`diffModels`、`modelHash`、Task 2 の `readMarker` / `featurePlans` / `planHashes` / `samePlans`、`resolveBaseCommit`
- Produces:
  - `src/approval.ts`: `export type ApprovalResult = { state: "approved" | "none" | "pending" | "rejected" | "stale" | "outside" | "error"; message: string; changed?: string[]; model?: Model; featureId?: string }`、`export async function checkFeatureApproval(repoRoot: string): Promise<ApprovalResult>`
  - `src/gate.ts`: `export type GateDecision = { decision: "allow" } | { decision: "deny"; reason: string }`、`export const GATED_SKILLS: ReadonlySet<string>`（`writing-plans`、`executing-plans`、`subagent-driven-development`）、`export async function gateSkill(repoRoot: string, skill: string): Promise<GateDecision>`、`export function gatePath(file: string): GateDecision`
  - CLI: `cli.js gate --repo <root> --skill <name>`、`cli.js gate --repo <root> --path <file>`。1 行の JSON を出力し、許可なら exit 0、拒否なら exit 1

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/gate.test.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { resolveFeature } from "../src/feature.js";
import { gatePath, gateSkill } from "../src/gate.js";
import { modelHash } from "../src/model/hash.js";
import { RDRA_DIR, parseModel, readModelFiles } from "../src/model/io.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { runTrace } from "../src/trace-run.js";
import { makeRepo, run } from "./helpers.js";
import { rdraFiles, tracedFeatureRepo } from "./trace-fixture.js";

const T = "2026-09-28T10:00:00+09:00";

async function approve(repo: string) {
  const feature = (await resolveFeature(repo))!;
  const hash = modelHash(parseModel(await readModelFiles(repo)));
  await writeReview(feature.reviewFile, decide(requestReview(emptyReview(), { now: T }), { decision: "approved", comments: [], hash, now: T }));
}

const reason = (d: { decision: string; reason?: string }) => (d.decision === "deny" ? d.reason : "");

describe("gateSkill", () => {
  it("allows skills it does not gate and anything outside a feature", async () => {
    const { repo } = await tracedFeatureRepo();
    expect(await gateSkill(repo, "superpowers:brainstorming")).toEqual({ decision: "allow" });
    expect(await gateSkill(await makeRepo(rdraFiles()), "superpowers:executing-plans")).toEqual({ decision: "allow" });
  });

  it("requires an approved, unchanged RDRA model for writing-plans", async () => {
    const { repo } = await tracedFeatureRepo();
    expect(reason(await gateSkill(repo, "superpowers:writing-plans"))).toContain("レビューがまだ依頼されていません");
    await approve(repo);
    expect(await gateSkill(repo, "writing-plans")).toEqual({ decision: "allow" });
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve"]);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.cart\n  name: カート画面\n");
    const stale = reason(await gateSkill(repo, "superpowers:writing-plans"));
    expect(stale).toContain("再レビュー");
    expect(stale).toContain("modified scr.cart");
  });

  it("requires a current trace marker for execution skills", async () => {
    const { repo, planPath } = await tracedFeatureRepo();
    await approve(repo);
    expect(reason(await gateSkill(repo, "superpowers:subagent-driven-development"))).toContain("/trace");
    expect((await runTrace(repo, T)).status).toBe("ok");
    expect(await gateSkill(repo, "superpowers:subagent-driven-development")).toEqual({ decision: "allow" });
    expect(await gateSkill(repo, "executing-plans")).toEqual({ decision: "allow" });

    // Ticking checkboxes during execution keeps the marker valid.
    const plan = join(repo, planPath);
    await writeFile(plan, (await readFile(plan, "utf8")).replace("- [ ] テストを書く", "- [x] テストを書く"));
    expect(await gateSkill(repo, "superpowers:executing-plans")).toEqual({ decision: "allow" });

    await writeFile(plan, (await readFile(plan, "utf8")) + "\n### Task 3\nCovers: pr.audit\n");
    expect(reason(await gateSkill(repo, "superpowers:executing-plans"))).toContain("計画が変更されました");
  });

  it("denies when the model cannot be read", async () => {
    const { repo } = await tracedFeatureRepo();
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: [\n");
    expect(reason(await gateSkill(repo, "superpowers:writing-plans"))).toContain("YAML");
  });
});

describe("gatePath", () => {
  it("denies review records anywhere and allows other files", () => {
    expect(gatePath("/work/repo/docs/rdra/reviews/42-x.json").decision).toBe("deny");
    expect(gatePath("/work/repo/.claude/worktrees/feature/42-x/docs/rdra/reviews/42-x.json").decision).toBe("deny");
    expect(gatePath("/work/repo/docs/rdra/usecases.yaml")).toEqual({ decision: "allow" });
    expect(gatePath("/work/repo/docs/rdra/reviews-notes.md")).toEqual({ decision: "allow" });
  });
});

describe("cli gate", () => {
  it("prints one JSON line and exits 0 / 1 / 64", async () => {
    const { repo } = await tracedFeatureRepo();
    const out: string[] = [];
    const io: CliIo = { out: (s) => void out.push(s), err: () => undefined };
    expect(await runCli(["gate", "--repo", repo, "--skill", "superpowers:writing-plans"], io)).toBe(1);
    expect(JSON.parse(out.pop()!)).toMatchObject({ decision: "deny" });
    expect(await runCli(["gate", "--repo", repo, "--skill", "superpowers:brainstorming"], io)).toBe(0);
    expect(JSON.parse(out.pop()!)).toEqual({ decision: "allow" });
    expect(await runCli(["gate", "--repo", repo, "--path", join(repo, "docs/rdra/reviews/001-demo.json")], io)).toBe(1);
    expect(await runCli(["gate", "--repo", repo], io)).toBe(64);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/gate.test.ts`
Expected: FAIL（`../src/gate.js` がない）

- [ ] **Step 3: `src/approval.ts` を実装し、`cli.ts` の承認判定を移す**

`src/approval.ts`（`cli.ts` にあった `MESSAGES`、`loadModel`、`changedSinceApproval`、`checkApproval` の中身をここへ移す）:

```ts
import { relative } from "node:path";
import { diffModels } from "./diff.js";
import { resolveFeature } from "./feature.js";
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
```

`src/cli.ts`: `MESSAGES`、`loadModel` のうち承認用の部分、`changedSinceApproval`、`checkApproval` を削除し、次に置き換える（`hash` コマンドは `parseModel(await readModelFiles(repo))` を直接使うように書き換える。`wait-review` の外側チェックのメッセージは `APPROVAL_MESSAGES.outside` を使う）:

```ts
async function checkApproval(repo: string, io: CliIo): Promise<number> {
  const { state, message, changed } = await checkFeatureApproval(repo);
  io.out(JSON.stringify(changed ? { state, message, changed } : { state, message }) + "\n");
  if (state === "approved") return 0;
  if (state === "outside") return 2;
  if (state === "error") return 3;
  return 1;
}
```

不要になった import（`relative`、`diffModels`、`lastCommitTouching`、`readModelFilesAt`、`approvalState`、`Model` など）は削除する。

Run: `npx vitest run test/cli.test.ts`
Expected: PASS（check-approval の挙動は変わらない）

- [ ] **Step 4: `src/gate.ts` を実装する**

```ts
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
```

- [ ] **Step 5: `src/cli.ts` に `gate` を追加する**

- import に `import { gatePath, gateSkill } from "./gate.js";` と `import { checkFeatureApproval, APPROVAL_MESSAGES } from "./approval.js";` を追加する
- `parseArgs` の options に `skill: { type: "string" }` と `path: { type: "string" }` を追加する
- `USAGE` の `trace` の行の後に `"  cli.js gate --repo <root> (--skill <name> | --path <file>)",` を追加する
- `runCli` の `trace` の分岐の後に追加:

```ts
  if (command === "gate" && repo && (values.skill || values.path)) {
    const decision = values.path ? gatePath(resolve(repo, values.path)) : await gateSkill(repo, values.skill!);
    io.out(JSON.stringify(decision) + "\n");
    return decision.decision === "allow" ? 0 : 1;
  }
```

（`resolve` を `node:path` から import する）

- [ ] **Step 6: テストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/approval.ts src/gate.ts src/cli.ts test/gate.test.ts
git commit -m "Add cli.js gate for plan and execution skills and review-record edits"
```

---

### Task 5: dist を再ビルドする

**Files:**
- Modify: `rdra-server/dist/`

- [ ] **Step 1: 全体の検証とビルド**

Run: `npm run typecheck && npx vitest run && npm run build && npx playwright test`
Expected: すべて PASS

- [ ] **Step 2: 同梱 CLI の動作を確認する**

Run: `node dist/cli.js gate --repo "$(git rev-parse --show-toplevel)" --skill superpowers:brainstorming`
Expected: `{"decision":"allow"}` を出力し、exit 0

- [ ] **Step 3: Commit**

```bash
git add -A dist
git commit -m "Rebuild rdra-server dist with trace and gate"
git status --short dist   # 何も出ないこと
```
