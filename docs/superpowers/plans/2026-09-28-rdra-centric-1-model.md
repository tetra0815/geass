# RDRA 中心パイプライン 計画 1: モデル拡張と feature 解決 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rdra-server の feature 解決を git flow のブランチ基準に置き換え、RDRA モデルに原則（`principles`）と受け入れ条件（`acceptance`）を追加して、MCP・問い合わせ・差分・レビュー UI で扱えるようにする。

**Architecture:** feature は `feature/<id>` ブランチから決まり、承認記録は `docs/rdra/reviews/<id>.json` に置く。`principles` は 9 番目の要素種別として `KINDS` に加わるため、ハッシュ・YAML 入出力・削除時の関連の解除は既存の仕組みにそのまま乗る。受け入れ条件はユースケースの属性として持ち、差分は ac 単位で報告する。

**Tech Stack:** TypeScript（Node 22.13+）、zod 4、yaml、node:sqlite、React 19 + @xyflow/react、vitest、Playwright

**Spec:** `docs/superpowers/specs/2026-09-28-rdra-centric-pipeline-design.md`（§4、§6.3）

## Global Constraints

- Node 22.13 以上（`package.json` の `engines` を変えない）
- 作業ディレクトリは `rdra-server/`。コマンドはすべてそこから実行する
- feature のプレフィックスは `git config gitflow.prefix.feature`（既定値 `feature/`）
- 差分の基点: `gitflow.branch.<branch>.base` → なければ `gitflow.branch.develop`（既定値 `develop`）。`origin/<base>` があればそちらとの merge-base を優先する
- 承認記録: `docs/rdra/reviews/<feature ID>.json`。`base_commit` は記録しない
- id の接頭辞 `pr`、ファイル `docs/rdra/principles.yaml`
- `category`: `business | quality | security | engineering | technology`、`level`: `must | should`
- `pr.scope` の参照先の接頭辞: `act` / `ext` / `buc` / `uc` / `scr` / `inf` / `st`
- 受け入れ条件の外部参照形式: `uc.<slug>#<ac id>`
- メッセージ・UI の文言は日本語（既存に合わせる）
- `dist/` は計画の最後に再ビルドして commit する（CI が `git diff --exit-code -- dist` で検査する）

## Review Focus

- **`feature/` の後ろにさらに `/` を含むブランチ**（`feature/a/b`）: 承認記録のパスが入れ子にならず、feature 外として扱われるべき → Task 1 のテストで固定する
- **`origin/develop` がなく、ローカルの `develop` だけがある**リポジトリ（リモートなしの個人利用）: ローカルの `develop` を基点にして差分が取れるべき → Task 1 のテストで固定する
- **既存モデル（受け入れ条件なしのユースケースが多数）**: 差分に含まれないユースケースに受け入れ条件がなくても、レビュー依頼が通るべき → Task 6 のテストで固定する
- **受け入れ条件の `then` が空白だけ**: 空として error にするべき → Task 3 のテストで固定する
- **原則が参照している要素を削除した場合**: `pr.scope` からも外れ、削除結果の `removedRelations` に含まれるべき → Task 2 のテストで固定する

---

### Task 1: git flow のブランチから feature と基点を解決する

旧来の `SPECIFY_FEATURE_DIRECTORY` / `.geass/feature.json` / `specs/<branch>` / `branch.<b>.geass-base-commit` による解決を削除し、`resolveFeature()` に一本化する。承認記録の読み書きはファイルパスを受け取る形に変え、`base_commit` を廃止する。

**Files:**
- Modify: `rdra-server/src/feature.ts`（全体を置き換え）
- Modify: `rdra-server/src/git.ts`（`gitConfig` 追加、`resolveBaseCommit` 置き換え、`rootWorktreeBranch` と `baseCommitConfigKey` 削除）
- Modify: `rdra-server/src/review.ts`（`REVIEW_FILE` 削除、`readReview`/`writeReview` をファイルパス引数に、`base_commit` 削除）
- Modify: `rdra-server/src/mcp.ts`、`rdra-server/src/http.ts`、`rdra-server/src/cli.ts`
- Modify: `rdra-server/web/src/api.ts`、`rdra-server/web/src/components/review-panel.tsx`
- Modify: `rdra-server/test/helpers.ts`、`test/git.test.ts`、`test/review.test.ts`、`test/mcp.test.ts`、`test/http.test.ts`、`test/cli.test.ts`、`e2e/review.spec.ts`

**Interfaces:**
- Produces:
  - `src/feature.ts`: `export const REVIEWS_DIR = "docs/rdra/reviews"`、`export interface Feature { id: string; branch: string; reviewFile: string }`（`reviewFile` は絶対パス）、`export async function resolveFeature(repoRoot: string): Promise<Feature | null>`
  - `src/git.ts`: `export async function gitConfig(repoRoot: string, key: string): Promise<string | null>`、`export async function resolveBaseCommit(repoRoot: string): Promise<string | null>`（シグネチャは不変）
  - `src/review.ts`: `readReview(file: string)`、`writeReview(file: string, record)`、`requestReview(record, opts: { now: string })`
  - CLI: `check-approval --repo <root>`、`wait-review --repo <root> [--interval-ms] [--timeout-sec]`（`--feature-dir` 廃止）。feature 外では `check-approval` は `{"state":"outside"}` で exit 2、`wait-review` は exit 3
  - `test/helpers.ts`: `export async function makeFeatureRepo(files?: Record<string,string>, id?: string): Promise<string>`（`main` 上に初期 commit、`develop` を同じ commit に作り、`feature/<id>`（既定 `001-demo`）を checkout した状態）
  - HTTP `/api/state` の `featureDir` を `feature: string | null`（feature ID）に置き換える

- [ ] **Step 1: テスト用ヘルパーを追加する**

`rdra-server/test/helpers.ts` の末尾に追加:

```ts
export async function makeFeatureRepo(files: Record<string, string> = {}, id = "001-demo"): Promise<string> {
  const dir = await makeRepo(files);
  run(dir, "git", ["branch", "develop"]);
  run(dir, "git", ["checkout", "-q", "-b", `feature/${id}`]);
  return dir;
}
```

- [ ] **Step 2: feature 解決と基点解決の失敗するテストを書く**

`rdra-server/test/git.test.ts` を次の内容で置き換える:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEWS_DIR, resolveFeature } from "../src/feature.js";
import { currentBranch, gitConfig, lastCommitTouching, readModelFilesAt, repoRootOf, resolveBaseCommit } from "../src/git.js";
import { makeFeatureRepo, makeRepo, run, writeFiles } from "./helpers.js";

const head = (repo: string) => run(repo, "git", ["rev-parse", "HEAD"]).trim();

async function commitFile(repo: string, path: string) {
  await writeFiles(repo, { [path]: path });
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", path]);
}

describe("git helpers", () => {
  it("returns null outside a repository", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-nogit-")));
    expect(await repoRootOf(dir)).toBeNull();
  });

  it("finds the repo root, branch and config values", async () => {
    const repo = await makeRepo();
    expect(await repoRootOf(repo)).toBe(repo);
    expect(await currentBranch(repo)).toBe("main");
    expect(await gitConfig(repo, "gitflow.prefix.feature")).toBeNull();
    run(repo, "git", ["config", "gitflow.prefix.feature", "feat/"]);
    expect(await gitConfig(repo, "gitflow.prefix.feature")).toBe("feat/");
  });

  it("reads model files at a commit and finds the last commit touching a path", async () => {
    const repo = await makeRepo({ "docs/rdra/actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await readModelFilesAt(repo, head(repo))).toEqual({ "actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await lastCommitTouching(repo, "docs/rdra/actors.yaml")).toBe(head(repo));
    expect(await lastCommitTouching(repo, "nothing.txt")).toBeNull();
  });
});

describe("resolveBaseCommit", () => {
  it("uses the merge-base with the local develop branch", async () => {
    const repo = await makeFeatureRepo();
    const base = head(repo);
    await commitFile(repo, "a.txt");
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("prefers the branch's recorded git-flow base", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "release/1.0"]);
    await commitFile(repo, "r.txt");
    const releaseHead = head(repo);
    run(repo, "git", ["checkout", "-q", "-b", "feature/x"]);
    run(repo, "git", ["config", "gitflow.branch.feature/x.base", "release/1.0"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(releaseHead);
  });

  it("honors gitflow.branch.develop", async () => {
    const repo = await makeRepo();
    const base = head(repo);
    run(repo, "git", ["branch", "dev"]);
    run(repo, "git", ["config", "gitflow.branch.develop", "dev"]);
    run(repo, "git", ["checkout", "-q", "-b", "feature/x"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("prefers origin/<base> over the local branch", async () => {
    const upstream = await makeRepo();
    run(upstream, "git", ["branch", "develop"]);
    const originBase = head(upstream);
    const repo = await realpath(await mkdtemp(join(tmpdir(), "rdra-clone-")));
    run(repo, "git", ["clone", "-q", upstream, "."]);
    run(repo, "git", ["config", "user.email", "test@example.com"]);
    run(repo, "git", ["config", "user.name", "test"]);
    run(repo, "git", ["config", "commit.gpgsign", "false"]);
    run(repo, "git", ["checkout", "-q", "-b", "develop", "origin/develop"]);
    await commitFile(repo, "local-develop.txt");
    // Cut from the local develop, which is ahead of origin/develop: the two
    // candidate merge-bases now differ, so the test tells them apart.
    run(repo, "git", ["checkout", "-q", "-b", "feature/x", "develop"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(originBase);
  });

  it("returns null on the base branch itself or when the base does not exist", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "develop"]);
    expect(await resolveBaseCommit(repo)).toBeNull();
    const other = await makeRepo();
    run(other, "git", ["checkout", "-q", "-b", "feature/x"]);
    expect(await resolveBaseCommit(other)).toBeNull();
  });
});

describe("resolveFeature", () => {
  it("derives the feature from a feature/ branch", async () => {
    const repo = await makeFeatureRepo({}, "42-order-cancel");
    expect(await resolveFeature(repo)).toEqual({
      id: "42-order-cancel",
      branch: "feature/42-order-cancel",
      reviewFile: join(repo, REVIEWS_DIR, "42-order-cancel.json"),
    });
  });

  it("honors gitflow.prefix.feature", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["config", "gitflow.prefix.feature", "feat/"]);
    run(repo, "git", ["checkout", "-q", "-b", "feat/demo"]);
    expect((await resolveFeature(repo))?.id).toBe("demo");
  });

  it("returns null outside a feature branch, for nested names and for detached HEAD", async () => {
    const repo = await makeRepo();
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "-b", "hotfix/x"]);
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "-b", "feature/a/b"]);
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "--detach"]);
    expect(await resolveFeature(repo)).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `npx vitest run test/git.test.ts`
Expected: FAIL（`resolveFeature` と `gitConfig` が export されていない）

- [ ] **Step 4: `src/git.ts` を実装する**

`rootWorktreeBranch`、`baseCommitConfigKey`、`resolveBaseCommit` を削除し、次を追加する（`git`、`repoRootOf`、`currentBranch`、`readModelFilesAt`、`lastCommitTouching` はそのまま残す）:

```ts
export async function gitConfig(repoRoot: string, key: string): Promise<string | null> {
  const r = await git(repoRoot, ["config", "--get", key]);
  const value = r.stdout.trim();
  return r.ok && value ? value : null;
}

async function verifiedCommit(repoRoot: string, ref: string): Promise<boolean> {
  return (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
}

export async function resolveBaseCommit(repoRoot: string): Promise<string | null> {
  const branch = await currentBranch(repoRoot);
  if (!branch) return null;
  const base =
    (await gitConfig(repoRoot, `gitflow.branch.${branch}.base`)) ?? (await gitConfig(repoRoot, "gitflow.branch.develop")) ?? "develop";
  if (base === branch) return null;
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if (!(await verifiedCommit(repoRoot, ref))) continue;
    const mb = await git(repoRoot, ["merge-base", "HEAD", ref]);
    if (mb.ok && mb.stdout.trim()) return mb.stdout.trim();
  }
  return null;
}
```

- [ ] **Step 5: `src/feature.ts` を置き換える**

```ts
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
```

- [ ] **Step 6: git と feature のテストが通ることを確認する**

Run: `npx vitest run test/git.test.ts`
Expected: PASS

- [ ] **Step 7: `src/review.ts` をファイルパス引数にし、`base_commit` を削除する**

`REVIEW_FILE` 定数を削除する。`ReviewRecord` から `base_commit` を削除する。`import { join }` を `import { dirname }` に変える。変更後の該当部分:

```ts
export interface ReviewRecord {
  status: ReviewStatus;
  approved_hash: string | null;
  requested_at: string | null;
  decided_at: string | null;
  rounds: ReviewRound[];
}

export function emptyReview(): ReviewRecord {
  return { status: "none", approved_hash: null, requested_at: null, decided_at: null, rounds: [] };
}

export async function readReview(file: string): Promise<ReviewRecord> {
  let text: string;
  try {
    text = await readFile(file, "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyReview();
    throw e;
  }
  const data = JSON.parse(text) as Record<string, unknown>;
  delete data.base_commit; // written by 0.11.0; the base is now resolved from git flow
  return { ...emptyReview(), ...(data as Partial<ReviewRecord>) };
}

export async function writeReview(file: string, record: ReviewRecord): Promise<void> {
  await mkdir(dirname(file), { recursive: true });
  // Write to a sibling temp file and rename over the target so a reader
  // (the gate, wait-review) never sees a half-written record.
  const tmp = `${file}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`;
  try {
    await writeFile(tmp, JSON.stringify(record, null, 2) + "\n", "utf8");
    await rename(tmp, file);
  } catch (e) {
    await rm(tmp, { force: true });
    throw e;
  }
}

export function requestReview(record: ReviewRecord, opts: { now: string }): ReviewRecord {
  return { ...record, status: "pending", approved_hash: null, requested_at: opts.now, decided_at: null };
}
```

`test/review.test.ts` を更新する:
- import から `REVIEW_FILE` を外す
- 各テストの `dir` を `file` に変え、`const file = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "docs", "rdra", "reviews", "001-x.json");` とする。`readReview(dir)` / `writeReview(dir, …)` / `join(dir, REVIEW_FILE)` はすべて `file` を使う
- 一時ファイルのテストは `expect(await readdir(dirname(file))).toEqual(["001-x.json"]);` にする（`dirname` を `node:path` から import）
- `requestReview(…, { now: T1, baseCommit: "abc" })` と `{ …, baseCommit: null }` は、すべて `{ now: T1 }` / `{ now: T2 }` にする
- `toMatchObject({ status: "pending", requested_at: T1, base_commit: "abc", approved_hash: null })` から `base_commit: "abc"` を外す
- 次のテストを追加する:

```ts
  it("drops the legacy base_commit field when reading", async () => {
    const file = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "r.json");
    await writeFile(file, JSON.stringify({ status: "pending", base_commit: "abc", approved_hash: null, requested_at: T1, decided_at: null, rounds: [] }));
    expect(await readReview(file)).toEqual({ status: "pending", approved_hash: null, requested_at: T1, decided_at: null, rounds: [] });
  });
```

（`writeFile` を `node:fs/promises` から import に加える）

- [ ] **Step 8: `src/mcp.ts` を `resolveFeature` に切り替える**

- import: `resolveFeatureDir` を `resolveFeature` に置き換える。`resolveBaseCommit` の import を削除する。`REVIEW_FILE` を import から外す。`import { join } from "node:path"` を `import { relative } from "node:path"` に変える
- `McpDeps` から `env` を削除し、`const env = …` の行を削除する
- `rdra_request_review` の本体を次に置き換える:

```ts
    async () => {
      const feature = await resolveFeature(store.repoRoot);
      if (!feature) {
        return fail("feature の外ではレビューを依頼できません。feature/* ブランチ（/feature-start で作った worktree）で実行してください");
      }
      if (store.parseError) return fail(`YAML にエラーがあります: ${store.parseError.message}`);
      const issues = validate(store.model);
      if (hasErrors(issues)) {
        const errors = issues.filter((i) => i.level === "error").map((i) => `- ${i.message}`);
        return fail(`エラーを解消してからレビューを依頼してください:\n${errors.join("\n")}`);
      }
      // Read-modify-write under the store lock so it cannot race a decision
      // arriving from the review UI.
      const record = await store.exclusive(async () => {
        const next = requestReview(await readReview(feature.reviewFile), { now: now() });
        await writeReview(feature.reviewFile, next);
        return next;
      });
      deps.onReviewChange?.();
      return json({ status: record.status, url: deps.reviewUrl(), reviewFile: relative(store.repoRoot, feature.reviewFile) });
    },
```

- `rdra_review_status` の本体:

```ts
    async () => {
      const feature = await resolveFeature(store.repoRoot);
      if (!feature) return json({ status: "none", approval: "none", lastRound: null, url: deps.reviewUrl(), note: "feature の外です" });
      const record = await readReview(feature.reviewFile);
      return json({
        status: record.status,
        approval: approvalState(record, store.version).state,
        lastRound: record.rounds.at(-1) ?? null,
        url: deps.reviewUrl(),
      });
    },
```

- [ ] **Step 9: `src/http.ts` を `resolveFeature` に切り替える**

- import: `resolveFeatureDir` → `resolveFeature`
- `HttpDeps` から `env` を削除し、`const env = …` の行を削除する
- `state()`:

```ts
  async function state() {
    const feature = await resolveFeature(store.repoRoot);
    const review = feature ? await readReview(feature.reviewFile) : null;
    return {
      version: store.version,
      parseError: store.parseError?.message ?? null,
      model: store.model,
      issues: validate(store.model),
      layout: await readLayout(store.repoRoot),
      feature: feature?.id ?? null,
      review,
      approval: review ? approvalState(review, store.version).state : "none",
    };
  }
```

- `decideReview` 内の `const featureDir = …` 以降を `const feature = await resolveFeature(store.repoRoot); if (!feature) throw new HttpError(404, "feature の外ではレビューできません");` にし、`readReview(featureDir)` / `writeReview(featureDir, next)` を `feature.reviewFile` に変える

`web/src/api.ts` の `AppState` で `featureDir: string | null;` を `feature: string | null;` に変える。`web/src/components/review-panel.tsx` の `!state.featureDir` を `!state.feature` に変える。

- [ ] **Step 10: `src/cli.ts` を `resolveFeature` に切り替える**

- import: `join, relative` → `relative`、`REVIEW_FILE` を外し `resolveFeature` を `./feature.js` から import
- `USAGE`:

```ts
const USAGE = [
  "usage:",
  "  cli.js check-approval --repo <root>",
  "  cli.js wait-review --repo <root> [--interval-ms 1000] [--timeout-sec 0]",
  "  cli.js hash --repo <root>",
  "  cli.js serve --repo <root> [--port 0]",
  "",
].join("\n");
```

- `MESSAGES` に `outside: "feature ブランチ（feature/*）の外です。"` を追加する
- `changedSinceApproval(repo, reviewFile, current)`: `lastCommitTouching(repo, relative(repo, reviewFile))` にする
- `checkApproval(repo, io)`:

```ts
async function checkApproval(repo: string, io: CliIo): Promise<number> {
  const feature = await resolveFeature(repo);
  if (!feature) {
    io.out(JSON.stringify({ state: "outside", message: MESSAGES.outside }) + "\n");
    return 2;
  }
  let model: Model;
  try {
    model = await loadModel(repo);
  } catch (e) {
    if (!(e instanceof ModelParseError)) throw e;
    io.out(JSON.stringify({ state: "error", message: `RDRA の YAML を読めません: ${e.message}` }) + "\n");
    return 3;
  }
  let review;
  try {
    review = await readReview(feature.reviewFile);
  } catch (e) {
    io.out(JSON.stringify({ state: "error", message: `承認記録を読めません: ${(e as Error).message}` }) + "\n");
    return 3;
  }
  const state = approvalState(review, modelHash(model));
  const result: { state: string; message: string; changed?: string[] } = { state: state.state, message: MESSAGES[state.state] };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, feature.reviewFile, model);
    if (changed) result.changed = changed;
  }
  io.out(JSON.stringify(result) + "\n");
  return state.state === "approved" ? 0 : 1;
}
```

- `safeRead(file)` と `waitReview(file, …)` は引数名を `file` にし、中の `readReview(featureDir)` を `readReview(file)`、エラーメッセージの `rdra-review.json を読めません` を `承認記録を読めません` にする
- `runCli` の options から `"feature-dir"` を削除し、分岐を次にする:

```ts
  if (command === "check-approval" && repo) return checkApproval(repo, io);
  if (command === "wait-review" && repo) {
    const feature = await resolveFeature(repo);
    if (!feature) {
      io.out(JSON.stringify({ state: "error", message: MESSAGES.outside }) + "\n");
      return 3;
    }
    return waitReview(feature.reviewFile, Number(values["interval-ms"] ?? "1000"), Number(values["timeout-sec"] ?? "0"), io);
  }
```

- [ ] **Step 11: MCP・HTTP・CLI のテストを新しい解決方法に合わせる**

`test/mcp.test.ts`:
- import の `REVIEW_FILE` を外し、`makeFeatureRepo` を helpers から import、`REVIEWS_DIR` を `../src/feature.js` から import
- `connect(repo, env = {}, onReviewChange?)` を `connect(repo, onReviewChange?)` にし、`createMcpServer` に `env` を渡さない
- 「diffs against the base commit」: `const repo = await makeFeatureRepo(rdraFiles());` とし、`git checkout` と `git config … geass-base-commit` の 2 行を削除する
- 「refuses to request a review outside a feature or with errors」: 2 つ目は `const repo = await makeFeatureRepo({ ...rdraFiles(), [`${RDRA_DIR}/screens.yaml`]: "[]\n" }); const inside = await connect(repo);`
- 「requests a review and reports its status」:

```ts
  it("requests a review and reports its status", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    let notified = 0;
    const { call } = await connect(repo, () => (notified += 1));
    const res = (await call("rdra_request_review")).json();
    expect(res).toMatchObject({ status: "pending", url: "http://127.0.0.1:1234/", reviewFile: `${REVIEWS_DIR}/001-demo.json` });
    expect(notified).toBe(1);
    const record = JSON.parse(await readFile(join(repo, REVIEWS_DIR, "001-demo.json"), "utf8"));
    expect(record.status).toBe("pending");
    expect(record).not.toHaveProperty("base_commit");
    expect((await call("rdra_review_status")).json()).toMatchObject({ status: "pending", approval: "pending", lastRound: null });
  });
```

`test/http.test.ts`:
- `REVIEW_FILE` を import から外し、`makeFeatureRepo` と `REVIEWS_DIR` を import、`const FEATURE = …` を削除
- `setup()`:

```ts
async function setup(opts: { webRoot?: string | null; feature?: boolean } = {}) {
  const repo = opts.feature === false ? await makeRepo(rdraFiles()) : await makeFeatureRepo(rdraFiles());
  const store = await RdraStore.open(repo);
  const reviewEvents = new EventEmitter();
  const http: RdraHttp = await startHttp({ store, reviewEvents, webRoot: opts.webRoot ?? null, now: () => "2026-09-25T10:00:00+09:00" });
  cleanups.push(() => store.close(), () => http.close());
  // call(...) は変更なし
  return { repo, store, http, call, reviewEvents, reviewFile: join(repo, REVIEWS_DIR, "001-demo.json") };
}
```

- テスト中の `featureDir` をすべて `reviewFile` にし、`join(featureDir, REVIEW_FILE)` は `reviewFile` にする。`requestReview(…, { now: "t", baseCommit: null })` は `{ now: "t" }` にする
- 「returns the diff against the base commit」から `git checkout` と `git config … geass-base-commit` の 2 行を削除する
- 「serves the current state」で `featureDir` を検査している箇所があれば `feature: "001-demo"` に変える（`grep -n featureDir test/http.test.ts` で確認）

`test/cli.test.ts`:
- `makeFeatureRepo` と `REVIEWS_DIR` を import。`check(repo)` は `runCli(["check-approval", "--repo", repo], c.io)` にする
- 「reports none, pending, …」: `const repo = await makeFeatureRepo(rdraFiles()); const file = join(repo, REVIEWS_DIR, "001-demo.json");` とし、`fd` を `file` に、`requestReview(…, { now: T, baseCommit: null })` を `{ now: T }` にする
- 「exits 3 on YAML errors」: `makeFeatureRepo({ [`${RDRA_DIR}/actors.yaml`]: "- id: [\n" })` と `check(repo)`
- 「exits 3 on corrupted review file」: `makeFeatureRepo(rdraFiles())`、`await mkdir(join(repo, REVIEWS_DIR), { recursive: true }); await writeFile(join(repo, REVIEWS_DIR, "001-demo.json"), "{ not json");`、期待するメッセージを `承認記録を読めません` にする
- 次のテストを `check-approval` の describe に追加する:

```ts
  it("exits 2 outside a feature branch", async () => {
    const repo = await makeRepo(rdraFiles());
    expect(await check(repo)).toMatchObject({ code: 2, result: { state: "outside" } });
  });
```

- `wait-review` の各テストは `makeFeatureRepo()` を使い、`const file = join(repo, REVIEWS_DIR, "001-demo.json")` に書き、`runCli(["wait-review", "--repo", repo, …])` から `--feature-dir …` を削除する。破損ファイルのテストの期待メッセージは `承認記録を読めません`。次を追加する:

```ts
  it("exits 3 outside a feature branch", async () => {
    const c = capture();
    expect(await runCli(["wait-review", "--repo", await makeRepo()], c.io)).toBe(3);
  });
```

- 「usage」テストの `expect(await runCli(["check-approval", "--repo", repo], capture().io)).toBe(64);` を `expect(await runCli(["check-approval"], capture().io)).toBe(64);` にする

`e2e/review.spec.ts`:
- `REVIEW_FILE` を import から外し、`makeFeatureRepo` と `REVIEWS_DIR`（`../src/feature.js`）を import。`FEATURE` 定数を削除
- `const reviewPath = () => join(repo, REVIEWS_DIR, "001-demo.json");`
- `requestAgain` の `{ now: …, baseCommit: null }` を `{ now: new Date().toISOString() }` にする
- `beforeAll`: `repo = await makeFeatureRepo(files); await mkdir(join(repo, REVIEWS_DIR), { recursive: true });`
- 最後の `check-approval` を `spawnSync("node", [cli, "check-approval", "--repo", repo], …)` にする

- [ ] **Step 12: 型検査とテストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: すべて PASS。`grep -rn "SPECIFY_FEATURE_DIRECTORY\|feature-dir\|geass-base-commit\|resolveFeatureDir\|REVIEW_FILE\|baseCommit" src web/src test e2e` が 0 件

- [ ] **Step 13: Commit**

```bash
git add -A src web/src test e2e
git commit -m "Resolve the feature from the git-flow branch and store reviews under docs/rdra/reviews"
```

---

### Task 2: 原則 `principles` の種別と `pr.scope` リレーション

**Files:**
- Modify: `rdra-server/src/model/kinds.ts`
- Modify: `rdra-server/src/model/relations.ts`
- Modify: `rdra-server/src/validate.ts`
- Modify: `rdra-server/web/src/components/palette.tsx`
- Test: `rdra-server/test/kinds.test.ts`、`test/validate.test.ts`、`test/operations.test.ts`

**Interfaces:**
- Produces:
  - `kinds.ts`: `PRINCIPLE_CATEGORIES`（`readonly ["business","quality","security","engineering","technology"]`）、`PrincipleCategorySchema`、`PrincipleLevelSchema`、`PrincipleSchema`、`type Principle = { id; name; description?; category; level; scope: string[] }`、`Model.principles: Principle[]`、`KindKey` に `"principles"`、`KINDS` の最後に `{ key: "principles", prefix: "pr", file: "principles.yaml", table: "principles", label: "原則" }`
  - `relations.ts`: `RelationKind` に `"pr.scope"`（field `scope`、shape `ids`、参照先 `act ext buc uc scr inf st`）
  - 検証コード `principle-without-description`（warning）

- [ ] **Step 1: 失敗するテストを書く**

`test/kinds.test.ts` の import に `PrincipleSchema` を加え、次のテストを追加する。また、既存の「resolves kinds by id prefix」の `KINDS.map((k) => k.file)` の期待値の末尾に `"principles.yaml"` を加え、`expect(kindOfId("pr.tdd")?.key).toBe("principles");` を追加する:

```ts
  it("accepts a principle with defaults and rejects unknown categories and levels", () => {
    expect(PrincipleSchema.parse({ id: "pr.tdd", name: "TDD", category: "engineering", level: "must" })).toEqual({
      id: "pr.tdd",
      name: "TDD",
      category: "engineering",
      level: "must",
      scope: [],
    });
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", category: "legal", level: "must" }).success).toBe(false);
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", category: "security", level: "may" }).success).toBe(false);
    expect(PrincipleSchema.safeParse({ id: "pr.x", name: "X", level: "must" }).success).toBe(false);
  });
```

`test/validate.test.ts` に追加:

```ts
describe("principles", () => {
  const withPrinciples = (yaml: string) => ({ ...sampleFiles(), "principles.yaml": yaml });

  it("links principles to their scope and accepts a valid model", () => {
    const files = withPrinciples(
      "- id: pr.audit\n  name: 監査ログ\n  description: 全更新を記録する\n  category: security\n  level: must\n  scope: [uc.place-order, inf.order]\n",
    );
    expect(relationsOf(parseModel(files))).toContainEqual({ from: "pr.audit", to: "uc.place-order", kind: "pr.scope", attrs: {} });
    expect(codes(files)).toEqual([]);
  });

  it("flags dangling and wrong-kind scope targets", () => {
    const files = withPrinciples(
      "- id: pr.a\n  name: A\n  description: d\n  category: security\n  level: must\n  scope: [uc.none, evt.payment-request]\n",
    );
    expect(codes(files)).toEqual(expect.arrayContaining(["error:dangling-ref:pr.a", "error:wrong-kind-ref:pr.a"]));
  });

  it("warns about must principles without a description", () => {
    const files = withPrinciples(
      "- id: pr.a\n  name: A\n  category: quality\n  level: must\n- id: pr.b\n  name: B\n  category: quality\n  level: should\n",
    );
    expect(codes(files)).toEqual(["warning:principle-without-description:pr.a"]);
  });
});
```

`test/operations.test.ts` に追加（ファイル冒頭の import に `applyOperations` と `sampleModel` があることを確認し、なければ追加する）:

```ts
  it("detaches principle scopes when the target is deleted", () => {
    const model = sampleModel();
    model.principles.push({ id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] });
    const { model: next, removedRelations } = applyOperations(model, [{ op: "delete", id: "uc.place-order" }]);
    expect(next.principles[0].scope).toEqual([]);
    expect(removedRelations).toContainEqual({ from: "pr.audit", to: "uc.place-order", kind: "pr.scope", attrs: {} });
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/kinds.test.ts test/validate.test.ts test/operations.test.ts`
Expected: FAIL（`PrincipleSchema` がない、`principles` が `Model` にない）

- [ ] **Step 3: `kinds.ts` に原則を追加する**

`KIND_KEYS` の末尾に `"principles"` を追加する。`StateModelSchema` の後に追加:

```ts
export const PRINCIPLE_CATEGORIES = ["business", "quality", "security", "engineering", "technology"] as const;
export const PrincipleCategorySchema = z.enum(PRINCIPLE_CATEGORIES);
export const PrincipleLevelSchema = z.enum(["must", "should"]);
export const PrincipleSchema = z.strictObject({
  ...common("pr"),
  category: PrincipleCategorySchema,
  level: PrincipleLevelSchema,
  scope: idList(),
});
export type Principle = z.output<typeof PrincipleSchema>;
```

`Model` に `principles: Principle[];` を追加し、`KINDS` の末尾に次を追加する:

```ts
  { key: "principles", prefix: "pr", file: "principles.yaml", table: "principles", label: "原則", schema: PrincipleSchema },
```

`emptyModel()` の戻り値に `principles: []` を追加する。

- [ ] **Step 4: `relations.ts` に `pr.scope` を追加する**

`RELATION_KINDS` の末尾に `"pr.scope"`、`RELATION_FIELDS` に `"pr.scope": { field: "scope", shape: "ids" }`、`RELATION_TARGET_PREFIXES` に `"pr.scope": ["act", "ext", "buc", "uc", "scr", "inf", "st"]` を追加する。

- [ ] **Step 5: `validate.ts` に警告を追加する**

`validate()` の `return issues;` の直前に追加:

```ts
  for (const p of model.principles) {
    if (p.level === "must" && !p.description?.trim()) {
      warn("principle-without-description", `${p.id} は MUST ですが、何を満たせば守ったことになるか（説明）がありません`, p.id);
    }
  }
```

- [ ] **Step 6: パレットから原則を除く**

原則は必須項目（分類・レベル）が多いため、原則ビュー（Task 7）から追加する。`web/src/components/palette.tsx` で `KINDS.map(...)` を `ADDABLE.map(...)` にし、コンポーネントの外に次を定義する:

```ts
const ADDABLE = KINDS.filter((k) => k.key !== "principles");
```

`const prefix = KINDS.find(...)` は `ADDABLE.find(...)` にする。

- [ ] **Step 7: MCP ツールの説明に原則を加える**

`src/mcp.ts` の `rdra_upsert` の `description` を次に置き換える:

```ts
        "要素を追加または更新する（既存 ID なら指定したフィールドだけを上書き）。kind: actors, externalSystems, bucs, usecases, screens, events, information, states, principles。ID は <接頭辞>.<スラッグ>（act, ext, buc, uc, scr, evt, inf, st, pr）。principles は category（business/quality/security/engineering/technology）と level（must/should）が必須。usecases の acceptance は [{id, given?, when, then}]。",
```

`rdra_link` の `description` の末尾（`inf.related には任意で attrs.label。` の後）に `pr.scope は pr -> act/ext/buc/uc/scr/inf/st（原則がかかる要素）。` を追加する。

`test/mcp.test.ts` の「upserts, links, reads, queries and validates」の末尾に追加:

```ts
    expect(
      (
        await call("rdra_upsert", {
          items: [{ kind: "principles", element: { id: "pr.audit", name: "監査", description: "d", category: "security", level: "must" } }],
        })
      ).isError,
    ).toBe(false);
    expect((await call("rdra_link", { links: [{ relation: "pr.scope", from: "pr.audit", to: "uc.browse" }] })).isError).toBe(false);
    expect((await call("rdra_get_model", { kind: "principles" })).json().model.principles[0].scope).toEqual(["uc.browse"]);
```

- [ ] **Step 8: テストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A src web/src test
git commit -m "Add principles (pr.*) to the RDRA model with a pr.scope relation"
```

---

### Task 3: ユースケースの受け入れ条件 `acceptance`

**Files:**
- Modify: `rdra-server/src/model/kinds.ts`
- Modify: `rdra-server/src/validate.ts`
- Test: `rdra-server/test/kinds.test.ts`、`test/validate.test.ts`、`test/io.test.ts`

**Interfaces:**
- Produces:
  - `kinds.ts`: `AcceptanceSchema`、`type Acceptance = { id: string; given?: string; when: string; then: string }`、`Usecase.acceptance: Acceptance[]`（既定 `[]`）
  - `export function acceptanceRef(usecaseId: string, acId: string): string`（`${usecaseId}#${acId}`）
  - 検証コード `duplicate-acceptance`（error）、`empty-acceptance`（error）

- [ ] **Step 1: 失敗するテストを書く**

`test/kinds.test.ts` に追加（import に `AcceptanceSchema, acceptanceRef` を加える）:

```ts
  it("parses acceptance criteria on usecases", () => {
    const uc = UsecaseSchema.parse({ id: "uc.a", name: "A", acceptance: [{ id: "ac1", when: "押す", then: "保存される" }] });
    expect(uc.acceptance).toEqual([{ id: "ac1", when: "押す", then: "保存される" }]);
    expect(UsecaseSchema.parse({ id: "uc.b", name: "B" }).acceptance).toEqual([]);
    expect(AcceptanceSchema.safeParse({ id: "AC1", when: "w", then: "t" }).success).toBe(false);
    expect(AcceptanceSchema.safeParse({ id: "ac1", then: "t" }).success).toBe(false);
    expect(AcceptanceSchema.safeParse({ id: "ac1", when: "w", then: "t", extra: 1 }).success).toBe(false);
    expect(acceptanceRef("uc.a", "ac1")).toBe("uc.a#ac1");
  });
```

`test/validate.test.ts` に追加:

```ts
describe("acceptance", () => {
  const withAcceptance = (lines: string[]) => {
    const files = sampleFiles();
    files["usecases.yaml"] += ["  acceptance:", ...lines, ""].join("\n");
    return files;
  };

  it("accepts well-formed criteria", () => {
    expect(codes(withAcceptance(["    - { id: ac1, given: 在庫あり, when: 注文する, then: 注文が作られる }"]))).toEqual([]);
  });

  it("flags duplicate ids and blank when/then", () => {
    expect(
      codes(
        withAcceptance([
          "    - { id: ac1, when: 注文する, then: 作られる }",
          "    - { id: ac1, when: 注文する, then: 作られる }",
          '    - { id: ac2, when: 注文する, then: "   " }',
          '    - { id: ac3, when: "", then: 作られる }',
        ]),
      ),
    ).toEqual([
      "error:duplicate-acceptance:uc.place-order",
      "error:empty-acceptance:uc.place-order",
      "error:empty-acceptance:uc.place-order",
    ]);
  });
});
```

`test/io.test.ts` に、YAML の往復テストを追加する（ファイル冒頭の import に `parseModel, serializeModel` と `sampleFiles` があることを確認する）:

```ts
  it("round-trips principles and acceptance criteria", () => {
    const files = sampleFiles();
    files["usecases.yaml"] += "  acceptance:\n    - { id: ac1, when: 注文する, then: 作られる }\n";
    files["principles.yaml"] = "- id: pr.tdd\n  name: TDD\n  category: engineering\n  level: must\n";
    const model = parseModel(files);
    expect(parseModel(serializeModel(model))).toEqual(model);
    expect(serializeModel(model)["principles.yaml"]).toContain("category: engineering");
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/kinds.test.ts test/validate.test.ts test/io.test.ts`
Expected: FAIL

- [ ] **Step 3: `kinds.ts` に受け入れ条件を追加する**

`UsecaseSchema` の前に追加:

```ts
export const AcceptanceSchema = z.strictObject({
  id: z.string().regex(slugPattern, "受け入れ条件の id はスラッグ（英小文字・数字・ハイフン）にしてください"),
  given: z.string().optional(),
  when: z.string(),
  then: z.string(),
});
export type Acceptance = z.output<typeof AcceptanceSchema>;

export function acceptanceRef(usecaseId: string, acId: string): string {
  return `${usecaseId}#${acId}`;
}
```

`UsecaseSchema` の `transitions: idList(),` の後に `acceptance: z.array(AcceptanceSchema).default(() => []),` を追加する。

`when` と `then` を `z.string().min(1)` にしないのは、空文字を YAML の読み込みエラー（モデル全体が読めなくなる）ではなく検証エラーとして報告するため。

- [ ] **Step 4: `validate.ts` に検証を追加する**

`for (const uc of model.usecases) { … }` のループ内の末尾に追加:

```ts
    const acIds = new Set<string>();
    for (const ac of uc.acceptance) {
      if (acIds.has(ac.id)) error("duplicate-acceptance", `${uc.id} の受け入れ条件 ${ac.id} が重複しています`, uc.id);
      acIds.add(ac.id);
      if (!ac.when.trim() || !ac.then.trim()) {
        error("empty-acceptance", `${uc.id} の受け入れ条件 ${ac.id} の when / then が空です`, uc.id);
      }
    }
```

- [ ] **Step 5: テストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A src test
git commit -m "Add acceptance criteria to RDRA usecases"
```

---

### Task 4: 問い合わせ用インデックスに原則と受け入れ条件を追加する

**Files:**
- Modify: `rdra-server/src/query.ts`
- Modify: `rdra-server/src/mcp.ts`（`rdra_query` の説明文）
- Test: `rdra-server/test/query.test.ts`

**Interfaces:**
- Produces: ビュー `principles`（`KINDS` から自動で作られる）、ビュー `principle_scope(principle_id, target_id)`、テーブル `acceptance(usecase_id, ac_id, ref, given_text, when_text, then_text)`

- [ ] **Step 1: 失敗するテストを書く**

`test/query.test.ts` に追加:

```ts
  it("indexes principles, their scope and acceptance criteria", () => {
    const m = sampleModel();
    m.principles.push({ id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] });
    m.usecases[0].acceptance.push({ id: "ac1", given: "在庫あり", when: "注文する", then: "作られる" });
    const index = new QueryIndex();
    index.rebuild(m);
    expect(index.query("SELECT id FROM principles")).toEqual([{ id: "pr.audit" }]);
    expect(index.query("SELECT principle_id, target_id FROM principle_scope")).toEqual([
      { principle_id: "pr.audit", target_id: "uc.place-order" },
    ]);
    expect(index.query("SELECT usecase_id, ac_id, ref, given_text, when_text, then_text FROM acceptance")).toEqual([
      { usecase_id: "uc.place-order", ac_id: "ac1", ref: "uc.place-order#ac1", given_text: "在庫あり", when_text: "注文する", then_text: "作られる" },
    ]);
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/query.test.ts`
Expected: FAIL（`no such table: principle_scope`）

- [ ] **Step 3: `query.ts` を実装する**

- import に `acceptanceRef` を `./model/kinds.js` から追加する
- コンストラクタの `CREATE TABLE state_transitions …;` の後に追加:

```sql
      CREATE TABLE acceptance (usecase_id TEXT NOT NULL, ac_id TEXT NOT NULL, ref TEXT NOT NULL, given_text TEXT, when_text TEXT NOT NULL, then_text TEXT NOT NULL);
      CREATE VIEW principle_scope AS SELECT from_id AS principle_id, to_id AS target_id FROM relations WHERE kind = 'pr.scope';
```

- `rebuild()` の `DELETE FROM …` に `DELETE FROM acceptance;` を追加する
- `insertTransition` のループの後に追加:

```ts
      const insertAcceptance = this.db.prepare("INSERT INTO acceptance VALUES (?, ?, ?, ?, ?, ?)");
      for (const uc of model.usecases) {
        for (const ac of uc.acceptance) insertAcceptance.run(uc.id, ac.id, acceptanceRef(uc.id, ac.id), ac.given ?? null, ac.when, ac.then);
      }
```

- [ ] **Step 4: `rdra_query` の説明を更新する**

`src/mcp.ts` の `rdra_query` の `description` を次に置き換える:

```ts
        "RDRA モデルに読み取り専用の SQL で問い合わせる。テーブル: elements(id, kind, name, description, data), relations(from_id, to_id, kind, attrs), state_nodes(model_id, state_id, name), state_transitions(model_id, from_state, to_state, ref), acceptance(usecase_id, ac_id, ref, given_text, when_text, then_text)。ビュー: principle_scope(principle_id, target_id)、種別ごとの actors, external_systems, bucs, usecases, screens, events, information, state_models, principles。",
```

- [ ] **Step 5: テストを実行する**

Run: `npx vitest run test/query.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/query.ts src/mcp.ts test/query.test.ts
git commit -m "Index principles, their scope and acceptance criteria for rdra_query"
```

---

### Task 5: 受け入れ条件を ac 単位で差分に報告する

**Files:**
- Modify: `rdra-server/src/diff.ts`
- Test: `rdra-server/test/diff.test.ts`

**Interfaces:**
- Produces: `export interface AcceptanceChange { id: string; type: ChangeType }`、`ElementChange.acceptance?: AcceptanceChange[]`（ユースケースの変更で、受け入れ条件に差があるときだけ付く。id 順）

- [ ] **Step 1: 失敗するテストを書く**

`test/diff.test.ts` に追加:

```ts
  it("reports acceptance criteria changes per criterion", () => {
    const before = sampleModel();
    before.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られる" },
      { id: "ac2", when: "取り消す", then: "取り消される" },
    ];
    const after = sampleModel();
    after.usecases[0].acceptance = [
      { id: "ac1", when: "注文する", then: "作られ、メールが届く" },
      { id: "ac3", when: "再注文する", then: "作られる" },
    ];
    const [change] = diffModels(before, after);
    expect(change).toMatchObject({ id: "uc.place-order", type: "modified", fields: ["acceptance"] });
    expect(change.acceptance).toEqual([
      { id: "ac1", type: "modified" },
      { id: "ac2", type: "removed" },
      { id: "ac3", type: "added" },
    ]);
  });

  it("reports every criterion of an added usecase as added and omits the field when nothing changed", () => {
    const after = sampleModel();
    after.usecases.push({
      id: "uc.cancel",
      name: "取り消す",
      actors: [],
      screens: [],
      events: [],
      information: [],
      transitions: [],
      acceptance: [{ id: "ac1", when: "取り消す", then: "取り消される" }],
    });
    const changes = diffModels(sampleModel(), after);
    expect(changes.find((c) => c.id === "uc.cancel")?.acceptance).toEqual([{ id: "ac1", type: "added" }]);
    const renamed = sampleModel();
    renamed.usecases[0].name = "注文を確定する";
    expect(diffModels(sampleModel(), renamed)[0]).not.toHaveProperty("acceptance");
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/diff.test.ts`
Expected: FAIL（`change.acceptance` が undefined）

- [ ] **Step 3: `diff.ts` を実装する**

```ts
import { canonicalize } from "./model/hash.js";
import { KINDS, type AnyElement, type KindKey, type Model, type Usecase } from "./model/kinds.js";

export type ChangeType = "added" | "removed" | "modified";

export interface AcceptanceChange {
  id: string;
  type: ChangeType;
}

export interface ElementChange {
  id: string;
  kind: KindKey;
  type: ChangeType;
  fields: string[];
  before?: AnyElement;
  after?: AnyElement;
  acceptance?: AcceptanceChange[];
}

function acceptanceChanges(before: Usecase | undefined, after: Usecase | undefined): AcceptanceChange[] {
  const prev = new Map((before?.acceptance ?? []).map((a) => [a.id, a]));
  const next = new Map((after?.acceptance ?? []).map((a) => [a.id, a]));
  const out: AcceptanceChange[] = [];
  for (const id of [...new Set([...prev.keys(), ...next.keys()])].sort()) {
    const a = prev.get(id);
    const b = next.get(id);
    if (!a) out.push({ id, type: "added" });
    else if (!b) out.push({ id, type: "removed" });
    else if (JSON.stringify(canonicalize(a)) !== JSON.stringify(canonicalize(b))) out.push({ id, type: "modified" });
  }
  return out;
}

function withAcceptance(change: ElementChange): ElementChange {
  if (change.kind !== "usecases") return change;
  const acceptance = acceptanceChanges(change.before as Usecase | undefined, change.after as Usecase | undefined);
  return acceptance.length > 0 ? { ...change, acceptance } : change;
}
```

`diffModels` の本体は変えず、`changes.push(x)` の 3 か所をすべて `changes.push(withAcceptance(x))` にする。

- [ ] **Step 4: テストを実行する**

Run: `npx vitest run test/diff.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/diff.ts test/diff.test.ts
git commit -m "Report acceptance criteria changes per criterion in the RDRA diff"
```

---

### Task 6: 受け入れ条件のない変更ユースケースがあればレビュー依頼を拒否する

**Files:**
- Modify: `rdra-server/src/validate.ts`
- Modify: `rdra-server/src/mcp.ts`（`rdra_request_review`、`rdra_validate`）
- Test: `rdra-server/test/validate.test.ts`、`test/mcp.test.ts`

**Interfaces:**
- Consumes: `diffAgainstBase(repoRoot, model): Promise<{ base: string | null; changes: ElementChange[] }>`（既存、`src/base-diff.ts`）、Task 5 の `ElementChange`
- Produces: `export function validateChanges(changes: ElementChange[]): Issue[]`（コード `usecase-without-acceptance`、level `error`）。`rdra_validate` の出力に `featureIssues: Issue[]` を追加する

- [ ] **Step 1: 失敗するテストを書く**

`test/validate.test.ts` に追加（import に `validateChanges` と `diffModels`（`../src/diff.js`）、`emptyModel`（`../src/model/kinds.js`）を加える）:

```ts
describe("validateChanges", () => {
  it("requires acceptance criteria only on added or modified usecases", () => {
    const base = sampleModel();
    const head = sampleModel();
    head.usecases[0].name = "注文を確定する";
    head.screens[0].name = "カート画面";
    expect(validateChanges(diffModels(base, head)).map((i) => `${i.level}:${i.code}:${i.elementId}`)).toEqual([
      "error:usecase-without-acceptance:uc.place-order",
    ]);
    head.usecases[0].acceptance.push({ id: "ac1", when: "注文する", then: "作られる" });
    expect(validateChanges(diffModels(base, head))).toEqual([]);
  });

  it("ignores removed usecases and unchanged ones", () => {
    const head = sampleModel();
    head.usecases = [];
    expect(validateChanges(diffModels(sampleModel(), head))).toEqual([]);
    expect(validateChanges(diffModels(sampleModel(), sampleModel()))).toEqual([]);
    expect(validateChanges(diffModels(emptyModel(), emptyModel()))).toEqual([]);
  });
});
```

`test/mcp.test.ts` に追加:

```ts
  it("refuses a review while a changed usecase has no acceptance criteria", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const { call } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "usecases", element: { id: "uc.place-order", name: "注文を確定する" } }] });
    expect((await call("rdra_validate")).json().featureIssues.map((i: { code: string }) => i.code)).toEqual(["usecase-without-acceptance"]);
    const refused = await call("rdra_request_review");
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("uc.place-order");

    await call("rdra_upsert", {
      items: [{ kind: "usecases", element: { id: "uc.place-order", acceptance: [{ id: "ac1", when: "注文する", then: "作られる" }] } }],
    });
    expect((await call("rdra_request_review")).isError).toBe(false);
  });
```

（既存の「requests a review and reports its status」は差分がないためそのまま通る。これが「既存モデルの受け入れ条件なしのユースケースでは拒否しない」ことのテストになる）

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/validate.test.ts test/mcp.test.ts`
Expected: FAIL

- [ ] **Step 3: `validate.ts` に `validateChanges` を追加する**

```ts
import type { ElementChange } from "./diff.js";
import type { Usecase } from "./model/kinds.js";

export function validateChanges(changes: ElementChange[]): Issue[] {
  return changes
    .filter((c) => c.kind === "usecases" && c.type !== "removed" && (c.after as Usecase).acceptance.length === 0)
    .map((c) => ({
      level: "error" as const,
      code: "usecase-without-acceptance",
      message: `${c.id} に受け入れ条件がありません（この feature で追加・変更したユースケースには 1 件以上必要です）`,
      elementId: c.id,
    }));
}
```

（`KINDS, type Model` の既存 import に `type Usecase` を足してもよい）

- [ ] **Step 4: `mcp.ts` に組み込む**

import に `validateChanges` を加える。ファイル内に次のヘルパーを追加する（`createMcpServer` の中、`applyTool` の後）:

```ts
  const featureIssues = async () => validateChanges((await diffAgainstBase(store.repoRoot, store.model)).changes);
```

`rdra_validate` の本体:

```ts
    async () => {
      try {
        return json({ parseError: store.parseError?.message ?? null, issues: validate(store.model), featureIssues: await featureIssues() });
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点の RDRA を読めません: ${e.message}`);
        throw e;
      }
    },
```

`rdra_validate` の `description` を `"RDRA モデルの整合性チェック。issues の error と featureIssues（この feature の差分に対する検査）はレビュー依頼を妨げ、warning は妨げない。"` にする。

`rdra_request_review` の `if (hasErrors(issues)) { … }` の直後に追加:

```ts
      let blockers;
      try {
        blockers = await featureIssues();
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点の RDRA を読めません: ${e.message}`);
        throw e;
      }
      if (blockers.length > 0) {
        return fail(`受け入れ条件が足りないためレビューを依頼できません:\n${blockers.map((i) => `- ${i.message}`).join("\n")}`);
      }
```

- [ ] **Step 5: テストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/validate.ts src/mcp.ts test/validate.test.ts test/mcp.test.ts
git commit -m "Refuse RDRA reviews while a changed usecase lacks acceptance criteria"
```

---

### Task 7: レビュー UI に原則ビューを追加する

**Files:**
- Create: `rdra-server/web/src/principles.ts`
- Create: `rdra-server/web/src/components/principles-table.tsx`
- Modify: `rdra-server/web/src/app.tsx`
- Modify: `rdra-server/web/src/styles.css`
- Test: `rdra-server/test/web-principles.test.ts`

**Interfaces:**
- Consumes: Task 2 の `Principle`、`PRINCIPLE_CATEGORIES`、Task 5 の `ElementChange`
- Produces:
  - `web/src/principles.ts`: `CATEGORY_LABELS: Record<Principle["category"], string>`、`interface PrincipleRow { principle: Principle; status?: ChangeType }`、`interface PrincipleGroup { category; label: string; rows: PrincipleRow[] }`、`groupPrinciples(model: Model, changes?: ElementChange[]): PrincipleGroup[]`、`mustPrinciplesFor(model: Model, id: string): Principle[]`、`parseScope(text: string): string[]`
  - `PrinciplesTable` props: `{ model: Model; changes: ElementChange[]; focus: string | null; disabled: boolean; onApply(ops): Promise<boolean>; onJump(id: string): void; onComment(id: string): void }`

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/web-principles.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { groupPrinciples, mustPrinciplesFor, parseScope } from "../web/src/principles.js";
import { sampleModel } from "./fixtures.js";

function withPrinciples() {
  const m = sampleModel();
  m.principles.push(
    { id: "pr.tdd", name: "TDD", category: "engineering", level: "must", scope: [] },
    { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
    { id: "pr.fast", name: "1 秒以内", category: "quality", level: "should", scope: ["uc.place-order"] },
  );
  return m;
}

describe("groupPrinciples", () => {
  it("groups by category in the fixed order and marks diff status, including removed ones", () => {
    const base = withPrinciples();
    const head = withPrinciples();
    head.principles = head.principles.filter((p) => p.id !== "pr.fast");
    head.principles.find((p) => p.id === "pr.audit")!.name = "監査ログ";
    head.principles.push({ id: "pr.gdpr", name: "個人情報", category: "security", level: "must", scope: [] });
    const groups = groupPrinciples(head, diffModels(base, head));
    expect(groups.map((g) => g.label)).toEqual(["品質", "セキュリティ", "開発プロセス"]);
    expect(groups[0].rows).toEqual([{ principle: expect.objectContaining({ id: "pr.fast" }), status: "removed" }]);
    expect(groups[1].rows.map((r) => `${r.principle.id}:${r.status ?? ""}`)).toEqual(["pr.audit:modified", "pr.gdpr:added"]);
    expect(groups[2].rows[0].status).toBeUndefined();
  });
});

describe("mustPrinciplesFor", () => {
  it("returns only must principles scoped to the element", () => {
    expect(mustPrinciplesFor(withPrinciples(), "uc.place-order").map((p) => p.id)).toEqual(["pr.audit"]);
    expect(mustPrinciplesFor(withPrinciples(), "scr.cart")).toEqual([]);
  });
});

describe("parseScope", () => {
  it("splits on commas, Japanese commas and whitespace", () => {
    expect(parseScope(" uc.a, inf.b、scr.c  st.d ")).toEqual(["uc.a", "inf.b", "scr.c", "st.d"]);
    expect(parseScope("  ")).toEqual([]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/web-principles.test.ts`
Expected: FAIL（モジュールがない）

- [ ] **Step 3: `web/src/principles.ts` を実装する**

```ts
import type { ChangeType, ElementChange } from "../../src/diff.js";
import { PRINCIPLE_CATEGORIES, type Model, type Principle } from "../../src/model/kinds.js";

export const CATEGORY_LABELS: Record<Principle["category"], string> = {
  business: "業務",
  quality: "品質",
  security: "セキュリティ",
  engineering: "開発プロセス",
  technology: "技術",
};

export interface PrincipleRow {
  principle: Principle;
  status?: ChangeType;
}

export interface PrincipleGroup {
  category: Principle["category"];
  label: string;
  rows: PrincipleRow[];
}

const byId = (a: Principle, b: Principle) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function groupPrinciples(model: Model, changes: ElementChange[] = []): PrincipleGroup[] {
  const own = changes.filter((c) => c.kind === "principles");
  const statusOf = new Map(own.map((c) => [c.id, c.type]));
  const removed = own.filter((c) => c.type === "removed" && c.before).map((c) => c.before as Principle);
  const all = [...model.principles, ...removed].sort(byId);
  return PRINCIPLE_CATEGORIES.map((category) => ({
    category,
    label: CATEGORY_LABELS[category],
    rows: all.filter((p) => p.category === category).map((p) => ({ principle: p, status: statusOf.get(p.id) })),
  })).filter((g) => g.rows.length > 0);
}

export function mustPrinciplesFor(model: Model, id: string): Principle[] {
  return model.principles.filter((p) => p.level === "must" && p.scope.includes(id));
}

export function parseScope(text: string): string[] {
  return text
    .split(/[\s,、]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `npx vitest run test/web-principles.test.ts`
Expected: PASS

- [ ] **Step 5: `principles-table.tsx` を作る**

```tsx
import { useState } from "react";
import type { ElementChange } from "../../../src/diff.js";
import { PRINCIPLE_CATEGORIES, SLUG, type Model, type Principle } from "../../../src/model/kinds.js";
import type { Operation } from "../../../src/operations.js";
import { CATEGORY_LABELS, groupPrinciples, parseScope } from "../principles.js";

interface Props {
  model: Model;
  changes: ElementChange[];
  focus: string | null;
  disabled: boolean;
  onApply: (ops: Operation[]) => Promise<boolean>;
  onJump: (id: string) => void;
  onComment: (id: string) => void;
}

const slugPattern = new RegExp(`^${SLUG}$`);

export function PrinciplesTable({ model, changes, focus, disabled, onApply, onJump, onComment }: Props) {
  const [editing, setEditing] = useState<string | null>(null);
  const groups = groupPrinciples(model, changes);
  return (
    <div className="principles-page">
      <h2>原則</h2>
      <PrincipleForm key="new" disabled={disabled} onApply={onApply} onDone={() => undefined} />
      {groups.length === 0 && <p className="hint">原則はまだありません。</p>}
      {groups.map((g) => (
        <section key={g.category}>
          <h3>{g.label}</h3>
          <table className="principles">
            <thead>
              <tr>
                <th>ID</th>
                <th>名前</th>
                <th>レベル</th>
                <th>対象</th>
                <th>説明</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {g.rows.map(({ principle: p, status }) =>
                editing === p.id ? (
                  <tr key={p.id}>
                    <td colSpan={6}>
                      <PrincipleForm initial={p} disabled={disabled} onApply={onApply} onDone={() => setEditing(null)} />
                    </td>
                  </tr>
                ) : (
                  <tr
                    key={p.id}
                    className={[status ? `rdra-${status}` : "", focus && (focus === p.id || p.scope.includes(focus)) ? "focused" : ""].join(" ")}
                  >
                    <td>
                      <code>{p.id}</code>
                    </td>
                    <td>{p.name}</td>
                    <td className={`level-${p.level}`}>{p.level.toUpperCase()}</td>
                    <td>
                      {p.scope.length === 0
                        ? "システム全体"
                        : p.scope.map((id) => (
                            <button key={id} className="link" onClick={() => onJump(id)}>
                              {id}
                            </button>
                          ))}
                    </td>
                    <td>{p.description}</td>
                    <td className="row">
                      {status !== "removed" && (
                        <>
                          <button disabled={disabled} onClick={() => setEditing(p.id)}>
                            編集
                          </button>
                          <button onClick={() => onComment(p.id)}>コメント</button>
                          <button disabled={disabled} onClick={() => void onApply([{ op: "delete", id: p.id }])}>
                            削除
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </section>
      ))}
    </div>
  );
}

function PrincipleForm({
  initial,
  disabled,
  onApply,
  onDone,
}: {
  initial?: Principle;
  disabled: boolean;
  onApply: Props["onApply"];
  onDone: () => void;
}) {
  const [slug, setSlug] = useState("");
  const [name, setName] = useState(initial?.name ?? "");
  const [category, setCategory] = useState<Principle["category"]>(initial?.category ?? "business");
  const [level, setLevel] = useState<Principle["level"]>(initial?.level ?? "must");
  const [scope, setScope] = useState((initial?.scope ?? []).join(", "));
  const [description, setDescription] = useState(initial?.description ?? "");
  const valid = name.trim() !== "" && (initial !== undefined || slugPattern.test(slug));

  const save = async () => {
    const element = {
      id: initial?.id ?? `pr.${slug}`,
      name: name.trim(),
      category,
      level,
      scope: parseScope(scope),
      description: description.trim() || null,
    };
    if (await onApply([{ op: "upsert", kind: "principles", element }])) {
      if (!initial) {
        setSlug("");
        setName("");
        setScope("");
        setDescription("");
      }
      onDone();
    }
  };

  return (
    <form
      className="principle-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void save();
      }}
    >
      {initial ? (
        <code>{initial.id}</code>
      ) : (
        <label>
          ID
          <span className="id-input">
            pr.
            <input aria-label="原則ID" value={slug} disabled={disabled} placeholder="audit-log" onChange={(e) => setSlug(e.target.value)} />
          </span>
        </label>
      )}
      <label>
        名前
        <input aria-label="原則名" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        分類
        <select aria-label="分類" value={category} disabled={disabled} onChange={(e) => setCategory(e.target.value as Principle["category"])}>
          {PRINCIPLE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABELS[c]}
            </option>
          ))}
        </select>
      </label>
      <label>
        レベル
        <select aria-label="レベル" value={level} disabled={disabled} onChange={(e) => setLevel(e.target.value as Principle["level"])}>
          <option value="must">MUST</option>
          <option value="should">SHOULD</option>
        </select>
      </label>
      <label>
        対象（カンマ区切り、空ならシステム全体）
        <input aria-label="対象" value={scope} disabled={disabled} placeholder="uc.place-order, inf.order" onChange={(e) => setScope(e.target.value)} />
      </label>
      <label>
        説明
        <textarea aria-label="原則の説明" value={description} disabled={disabled} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" disabled={disabled || !valid}>
          {initial ? "保存" : "原則を追加"}
        </button>
        {initial && (
          <button type="button" onClick={onDone}>
            やめる
          </button>
        )}
      </div>
    </form>
  );
}
```

- [ ] **Step 6: `app.tsx` に原則ページを組み込む**

- import に `PrinciplesTable` を追加する
- state を追加: `const [page, setPage] = useState<"diagram" | "principles">("diagram");` と `const [focus, setFocus] = useState<string | null>(null);`
- `jump` を置き換える:

```tsx
  const jump = (id: string) => {
    if (id.startsWith("pr.")) {
      setPage("principles");
      setFocus(id);
      return;
    }
    setPage("diagram");
    setView(viewForId(id));
    setSelection({ type: "node", id });
  };

  const openPrinciples = (id: string) => {
    setPage("principles");
    setFocus(id);
  };
```

- `<nav>` の中身を置き換える:

```tsx
        <nav>
          {VIEW_KEYS.map((v) => (
            <button
              key={v}
              className={page === "diagram" && v === view ? "active" : ""}
              onClick={() => {
                setPage("diagram");
                setView(v);
              }}
            >
              {VIEW_LABELS[v]}
            </button>
          ))}
          <button className={page === "principles" ? "active" : ""} onClick={() => openPrinciples("")}>
            原則
          </button>
        </nav>
```

（`openPrinciples("")` は focus を空文字にし、どの行も強調しない）

- `<div className="canvas">…</div>` を次の条件分岐に置き換える:

```tsx
        {page === "principles" ? (
          <div className="canvas">
            <PrinciplesTable
              model={state.model}
              changes={diffMode && diff ? diff.changes : []}
              focus={focus || null}
              disabled={readOnly}
              onApply={apply}
              onJump={jump}
              onComment={setCommentTarget}
            />
          </div>
        ) : (
          <div className="canvas">
            {/* 既存の Palette と DiagramCanvas（または読み込み中表示）をそのまま置く */}
          </div>
        )}
```

コメント行は実際には既存の `<Palette … />` と `{layout?.view === view ? (<DiagramCanvas … />) : (…)}` をそのまま移したものに置き換える。

- [ ] **Step 7: スタイルを追加する**

`web/src/styles.css` の末尾に追加:

```css
.principles-page {
  padding: 16px;
  overflow: auto;
  height: 100%;
  box-sizing: border-box;
}
.principle-form {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: flex-end;
  margin-bottom: 16px;
}
.principle-form label {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
table.principles {
  width: 100%;
  border-collapse: collapse;
  background: #fff;
  margin-bottom: 16px;
}
table.principles th,
table.principles td {
  border: 1px solid #d0d7de;
  padding: 4px 8px;
  text-align: left;
  vertical-align: top;
}
table.principles tr.focused {
  background: #ddf4ff;
}
.level-must {
  font-weight: bold;
  color: #cf222e;
}
.badge {
  margin-left: 6px;
  padding: 0 6px;
  font-size: 11px;
  border-radius: 999px;
  border-color: #cf222e;
  color: #cf222e;
}
```

`table.principles tr.rdra-added` などは既存の `.rdra-added` / `.rdra-modified` / `.rdra-removed`（outline）がそのまま効く。

- [ ] **Step 8: 型検査とテストを実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add -A web/src test/web-principles.test.ts
git commit -m "Add a principles view to the RDRA review UI"
```

---

### Task 8: ユースケースの受け入れ条件の編集と、MUST 原則のバッジ

**Files:**
- Modify: `rdra-server/web/src/components/inspector.tsx`
- Modify: `rdra-server/web/src/views.ts`
- Modify: `rdra-server/web/src/components/diagram-canvas.tsx`
- Modify: `rdra-server/web/src/app.tsx`
- Test: `rdra-server/test/web-views.test.ts`、`rdra-server/e2e/review.spec.ts`

**Interfaces:**
- Consumes: Task 3 の `Acceptance`、`Usecase`、Task 7 の `mustPrinciplesFor`
- Produces: `DiagramNode.principles?: number`（ユースケース複合図のユースケースにかかる MUST 原則の件数。0 件なら付けない）、`DiagramCanvas` の props に `onOpenPrinciples: (id: string) => void`

- [ ] **Step 1: 失敗するテストを書く**

`test/web-views.test.ts` の `describe("projectView", …)` に追加:

```ts
  it("counts must principles on usecases in the usecase composite", () => {
    const m = sampleModel();
    m.principles.push(
      { id: "pr.audit", name: "監査", category: "security", level: "must", scope: ["uc.place-order"] },
      { id: "pr.fast", name: "速い", category: "quality", level: "should", scope: ["uc.place-order"] },
    );
    const d = projectView("usecase-composite", m);
    expect(d.nodes.find((n) => n.id === "uc.place-order")?.principles).toBe(1);
    expect(d.nodes.find((n) => n.id === "scr.cart")?.principles).toBeUndefined();
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `npx vitest run test/web-views.test.ts`
Expected: FAIL

- [ ] **Step 3: `views.ts` にバッジ件数を付ける**

- import に `import { mustPrinciplesFor } from "./principles.js";` を追加する
- `DiagramNode` に `principles?: number;` を追加する
- `projectElements` のノード追加部分を置き換える:

```ts
    for (const e of model[kind.key] as AnyElement[]) {
      const count = view === "usecase-composite" && kind.prefix === "uc" ? mustPrinciplesFor(model, e.id).length : 0;
      nodes.push({ id: e.id, type: kind.prefix, label: e.name, elementId: e.id, status: statusOf.get(e.id), principles: count || undefined });
    }
```

- [ ] **Step 4: `diagram-canvas.tsx` でバッジを描く**

- `Props` に `onOpenPrinciples: (id: string) => void;` を追加し、分割代入にも加える
- `initialNodes` の `data: { label: n.label },` を次に置き換え、`useMemo` の依存配列に `onOpenPrinciples` を加える:

```tsx
        data: {
          label: n.principles ? (
            <span>
              {n.label}
              <button
                className="badge"
                title="この要素にかかる MUST 原則"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpenPrinciples(n.elementId);
                }}
              >
                原則 {n.principles}
              </button>
            </span>
          ) : (
            n.label
          ),
        },
```

`app.tsx` の `<DiagramCanvas … />` に `onOpenPrinciples={openPrinciples}` を追加する。

- [ ] **Step 5: インスペクターに受け入れ条件エディターを追加する**

`inspector.tsx`:
- import に `type Acceptance, type Usecase` を `kinds.js` から加える
- `ElementInspector` の `{kind.key === "usecases" && <TransitionPicker … />}` の直後に追加:

```tsx
      {kind.key === "usecases" && <AcceptanceEditor usecase={element as Usecase} disabled={disabled} onApply={onApply} />}
```

- ファイル末尾に追加:

```tsx
function AcceptanceEditor({ usecase, disabled, onApply }: { usecase: Usecase; disabled: boolean; onApply: Props["onApply"] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = (acceptance: Acceptance[]) => onApply([{ op: "upsert", kind: "usecases", element: { id: usecase.id, acceptance } }]);
  const replace = (next: Acceptance) => save(usecase.acceptance.map((a) => (a.id === next.id ? next : a))).then((ok) => ok && setEditing(null));

  return (
    <div className="acceptance">
      <h4>受け入れ条件</h4>
      {usecase.acceptance.length === 0 && <p className="hint">まだありません。この feature で変更したユースケースには 1 件以上必要です。</p>}
      <ul className="relations">
        {usecase.acceptance.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AcceptanceForm initial={a} existing={[]} disabled={disabled} onSave={replace} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id}>
              <span>
                <code>{a.id}</code> {a.given && <>Given {a.given} / </>}When {a.when} / Then {a.then}
              </span>
              <button disabled={disabled} onClick={() => setEditing(a.id)}>
                編集
              </button>
              <button disabled={disabled} onClick={() => void save(usecase.acceptance.filter((x) => x.id !== a.id))}>
                外す
              </button>
            </li>
          ),
        )}
      </ul>
      <AcceptanceForm
        existing={usecase.acceptance.map((a) => a.id)}
        disabled={disabled}
        onSave={(a) => save([...usecase.acceptance, a])}
      />
    </div>
  );
}

function AcceptanceForm({
  initial,
  existing,
  disabled,
  onSave,
  onCancel,
}: {
  initial?: Acceptance;
  existing: string[];
  disabled: boolean;
  onSave: (a: Acceptance) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [given, setGiven] = useState(initial?.given ?? "");
  const [when, setWhen] = useState(initial?.when ?? "");
  const [then, setThen] = useState(initial?.then ?? "");
  const valid = slugPattern.test(id) && !existing.includes(id) && when.trim() !== "" && then.trim() !== "";

  const submit = async () => {
    const ok = await onSave({ id, given: given.trim() || undefined, when: when.trim(), then: then.trim() });
    if (ok === true && !initial) {
      setId("");
      setGiven("");
      setWhen("");
      setThen("");
    }
  };

  return (
    <div className="add-relation">
      {initial ? (
        <code>{initial.id}</code>
      ) : (
        <input aria-label="受け入れ条件ID" placeholder="ac1" value={id} disabled={disabled} onChange={(e) => setId(e.target.value)} />
      )}
      <input aria-label="Given" placeholder="前提（任意）" value={given} disabled={disabled} onChange={(e) => setGiven(e.target.value)} />
      <input aria-label="When" placeholder="操作" value={when} disabled={disabled} onChange={(e) => setWhen(e.target.value)} />
      <input aria-label="Then" placeholder="結果" value={then} disabled={disabled} onChange={(e) => setThen(e.target.value)} />
      <div className="row">
        <button disabled={disabled || !valid} onClick={() => void submit()}>
          {initial ? "保存" : "受け入れ条件を追加"}
        </button>
        {onCancel && <button onClick={onCancel}>やめる</button>}
      </div>
    </div>
  );
}
```

- [ ] **Step 6: 単体テストと型検査を実行する**

Run: `npm run typecheck && npx vitest run`
Expected: PASS

- [ ] **Step 7: E2E テストを追加する**

`e2e/review.spec.ts` の末尾に、2 つ目のテストを追加する（同じ `repo` と `url` を使う。1 つ目のテストでレビューが承認済みになっていても、編集はできる）:

```ts
test("add a principle, give the usecase acceptance criteria, and follow the badge", async ({ page }) => {
  await page.goto(url);
  await page.getByRole("button", { name: "原則", exact: true }).click();
  await page.getByLabel("原則ID").fill("audit-log");
  await page.getByLabel("原則名").fill("全ての更新を監査ログに残す");
  await page.getByLabel("分類").selectOption("security");
  await page.getByLabel("対象").fill("uc.place-order");
  await page.getByLabel("原則の説明").fill("誰が・いつ・何を変えたかを記録する");
  await page.getByRole("button", { name: "原則を追加" }).click();
  await expect(page.getByRole("cell", { name: "全ての更新を監査ログに残す" })).toBeVisible();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "principles.yaml"), "utf8")).toContain("pr.audit-log");

  await page.getByRole("button", { name: "ユースケース複合" }).click();
  await page.locator(".react-flow__node", { hasText: "注文する" }).click();
  await page.getByLabel("受け入れ条件ID").fill("ac1");
  await page.getByLabel("Given").fill("カートに商品がある");
  await page.getByLabel("When").fill("注文を確定する");
  await page.getByLabel("Then").fill("注文が作られる");
  await page.getByRole("button", { name: "受け入れ条件を追加" }).click();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toContain("then: 注文が作られる");

  await page.locator(".react-flow__node", { hasText: "注文する" }).getByRole("button", { name: "原則 1" }).click();
  await expect(page.locator("tr.focused", { hasText: "pr.audit-log" })).toBeVisible();
});
```

- [ ] **Step 8: dist を再ビルドし、E2E を実行する**

Run: `npm run build && npx playwright test`
Expected: 2 件とも PASS（初回は `npx playwright install chromium` が必要）

- [ ] **Step 9: Commit**

```bash
git add -A web/src test e2e
git commit -m "Edit usecase acceptance criteria and show must-principle badges in the review UI"
```

---

### Task 9: dist を再ビルドして全体を検証する

**Files:**
- Modify: `rdra-server/dist/`（ビルド成果物）

- [ ] **Step 1: 全体の検証**

Run: `npm run typecheck && npx vitest run && npm run build && npx playwright test`
Expected: すべて PASS

- [ ] **Step 2: dist が最新であることを確認して commit する**

```bash
git add -A dist
git commit -m "Rebuild rdra-server dist for principles, acceptance and git-flow features"
git status --short dist   # 何も出ないこと
```
