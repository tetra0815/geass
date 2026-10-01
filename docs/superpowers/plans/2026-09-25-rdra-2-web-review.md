# RDRA 2/3: レビュー用 Web アプリ実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** rdra-server に HTTP/WebSocket と React 製のレビュー画面を追加し、人間が RDRA の図を 5 つのビューで確認・GUI 編集し、差分を見て、承認または差し戻しできるようにする。

**Architecture:** MCP サーバーと同じプロセスで `127.0.0.1` の空きポートに HTTP サーバーを立てる。書き込みはすべて計画 1/3 の `RdraStore` を経由し、変更は WebSocket で画面に通知する。画面は React + React Flow で、モデルを図に投影する処理と関連の推定は React から切り離した純粋関数にしてテストする。Vite でビルドした成果物を `dist/web/` に置き、HTTP サーバーが配信する。

**Tech Stack:** 計画 1/3 の構成に加えて ws 8, React 19, @xyflow/react 12, elkjs 0.12, Vite 8, @vitejs/plugin-react 6, Playwright 1.63

**Spec:** `docs/superpowers/specs/2026-09-25-rdra-review-gate-design.md`

**前提:** 計画 1/3（`docs/superpowers/plans/2026-09-25-rdra-1-core-mcp.md`）が完了していること。

**この計画の範囲:** 設計書の 3.1 章（`layout/`）、4.2〜4.3 章の `http` モジュールと楽観的ロック、5 章（Web アプリ）、6 章の承認・差し戻しの記録、8 章のうち Web 側のエラー処理、9 章の Playwright。パイプラインへの組み込み（`/rdra` スキル、ゲート）は計画 3/3。

## Global Constraints

- 計画 1/3 の Global Constraints をすべて引き継ぐ。
- HTTP は `127.0.0.1` にだけバインドする。`Host` ヘッダーが `127.0.0.1:<port>` か `localhost:<port>` 以外なら 403（DNS rebinding 対策）。
- GET 以外のリクエストは `x-rdra-client: web` ヘッダーが必須（他サイトからの単純なフォーム送信を防ぐ）。
- 承認・差し戻しは HTTP の `POST /api/review/decision` だけで行う。MCP には追加しない。
- 承認はエラー 0 件、かつ画面が見ていた版（`version`）が現在の版と一致するときだけ受け付ける。判定と書き込みは `RdraStore` のキューの中で行う。
- `layout/` の座標は意味上のモデルに含めない（承認ハッシュを変えない）。
- 画面の文言は日本語。
- Web のコードは `rdra-server/web/src/` に置き、サーバー側の型と純粋関数（`src/model/*`, `src/operations.ts`）は相対 import で共有する。Node 専用モジュール（`node:fs` など）を使うファイルは型の import だけにする。
- ファイル名は kebab-case、React コンポーネント名は PascalCase。

## ファイル構成

```
rdra-server/
  src/model/view-keys.ts          ビューの一覧と座標の型（純粋）
  src/layout.ts                   docs/rdra/layout/<view>.yaml の読み書き
  src/base-diff.ts                分岐点との差分（MCP と HTTP で共有）
  src/http.ts                     REST API、WebSocket、静的ファイル配信
  src/serve.ts                    CLI の serve コマンド（MCP なしで HTTP だけ起動）
  src/store.ts                    setLayout と exclusive を追加
  src/operations.ts               upsert で null を「フィールドの削除」として扱う
  src/mcp.ts                      base-diff の利用、レビュー依頼の通知
  src/server.ts                   HTTP も起動し、reviewUrl を返す
  src/cli.ts                      serve コマンドを追加
  vite.config.ts  vitest.config.ts  playwright.config.ts  build.mjs
  web/
    index.html  tsconfig.json
    src/main.tsx  src/app.tsx  src/api.ts  src/styles.css
    src/views.ts                  モデル -> 図（ノードとエッジ）の投影（純粋）
    src/infer.ts                  ドラッグで結んだ 2 要素から関連を推定（純粋）
    src/auto-layout.ts            elkjs による自動配置
    src/components/diagram-canvas.tsx  palette.tsx  inspector.tsx  review-panel.tsx
  test/layout.test.ts  test/http.test.ts  test/web-views.test.ts
  e2e/review.spec.ts
```

---

### Task 1: レイアウトの保存と、編集まわりのストア拡張

**Files:**
- Create: `rdra-server/src/model/view-keys.ts`
- Create: `rdra-server/src/layout.ts`
- Modify: `rdra-server/src/store.ts`
- Modify: `rdra-server/src/operations.ts`
- Test: `rdra-server/test/layout.test.ts`
- Modify: `rdra-server/test/operations.test.ts`

**Interfaces:**
- Consumes: `RDRA_DIR`（計画 1 Task 2）、`RdraStore`（計画 1 Task 9）、`applyOperations`（計画 1 Task 8）
- Produces:
  - `VIEW_KEYS`（`"system-context" | "business-flow" | "usecase-composite" | "information-model" | "state-model"`）、`type ViewKey`、`VIEW_LABELS: Record<ViewKey, string>`
  - `interface Position { x: number; y: number }`、`type Positions = Record<string, Position>`、`type Layout = Record<ViewKey, Positions>`
  - `isViewKey(value: string): value is ViewKey`、`emptyLayout(): Layout`
  - `LAYOUT_DIR = "docs/rdra/layout"`、`readLayout(repoRoot): Promise<Layout>`、`writeLayoutView(repoRoot, view, positions): Promise<Positions>`（既存とマージし、整数に丸め、ID 順に保存）
  - `RdraStore.setLayout(view, positions): Promise<Positions>`（キュー内で書き、`"layout"` イベントを発火。版は変えない）
  - `RdraStore.exclusive<T>(fn: () => Promise<T>): Promise<T>`（キュー内で任意の処理を実行）
  - `applyOperations` の `upsert` で、値が `null` のフィールドは削除する（画面で説明を空にして保存する場合など）

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/layout.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LAYOUT_DIR, readLayout, writeLayoutView } from "../src/layout.js";
import { modelHash } from "../src/model/hash.js";
import { RdraStore } from "../src/store.js";
import { makeRepo } from "./helpers.js";

describe("layout", () => {
  it("reads an empty layout for every view when nothing is stored", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-layout-"));
    const layout = await readLayout(dir);
    expect(Object.keys(layout)).toEqual(["system-context", "business-flow", "usecase-composite", "information-model", "state-model"]);
    expect(layout["usecase-composite"]).toEqual({});
  });

  it("merges, rounds, sorts and drops invalid positions", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-layout-"));
    await writeLayoutView(dir, "information-model", { "inf.b": { x: 10.4, y: 20.6 } });
    const merged = await writeLayoutView(dir, "information-model", {
      "inf.a": { x: 1, y: 2 },
      "inf.bad": { x: Number.NaN, y: 0 } as never,
    });
    expect(merged).toEqual({ "inf.a": { x: 1, y: 2 }, "inf.b": { x: 10, y: 21 } });
    expect(await readFile(join(dir, LAYOUT_DIR, "information-model.yaml"), "utf8")).toBe(
      "inf.a:\n  x: 1\n  y: 2\ninf.b:\n  x: 10\n  y: 21\n",
    );
    expect((await readLayout(dir))["information-model"]).toEqual(merged);
  });

  it("is written through the store without changing the model version", async () => {
    const repo = await makeRepo();
    const store = await RdraStore.open(repo);
    const events: string[] = [];
    store.on("layout", () => events.push("layout"));
    store.on("change", () => events.push("change"));
    await store.setLayout("state-model", { "st.order": { x: 5, y: 5 } });
    expect(store.version).toBe(modelHash(store.model));
    expect(events).toEqual(["layout"]);
    store.close();
  });
});
```

`rdra-server/test/operations.test.ts` の `it("rejects schema violations with the element id in the message", ...)` の直前に追加する:

```ts
  it("removes fields set to null", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "events", element: { id: "evt.payment-request", target: null, description: null } },
    ]);
    expect(model.events[0]).toEqual({ id: "evt.payment-request", name: "決済依頼" });
  });
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/layout.test.ts test/operations.test.ts`
Expected: FAIL（`../src/layout.js` が見つからない、`removes fields set to null` が失敗）

- [ ] **Step 3: ビューの定義とレイアウトの読み書きを実装する**

`rdra-server/src/model/view-keys.ts`:

```ts
export const VIEW_KEYS = [
  "system-context",
  "business-flow",
  "usecase-composite",
  "information-model",
  "state-model",
] as const;
export type ViewKey = (typeof VIEW_KEYS)[number];

export const VIEW_LABELS: Record<ViewKey, string> = {
  "system-context": "システムコンテキスト",
  "business-flow": "業務フロー",
  "usecase-composite": "ユースケース複合",
  "information-model": "情報モデル",
  "state-model": "状態モデル",
};

export interface Position {
  x: number;
  y: number;
}
export type Positions = Record<string, Position>;
export type Layout = Record<ViewKey, Positions>;

export function isViewKey(value: string): value is ViewKey {
  return (VIEW_KEYS as readonly string[]).includes(value);
}

export function emptyLayout(): Layout {
  return Object.fromEntries(VIEW_KEYS.map((v) => [v, {}])) as Layout;
}
```

`rdra-server/src/layout.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parse, stringify } from "yaml";
import { RDRA_DIR } from "./model/io.js";
import { VIEW_KEYS, emptyLayout, type Layout, type Positions, type ViewKey } from "./model/view-keys.js";

export const LAYOUT_DIR = `${RDRA_DIR}/layout`;

function sanitize(data: unknown): Positions {
  const out: Positions = {};
  if (data === null || typeof data !== "object" || Array.isArray(data)) return out;
  for (const [id, value] of Object.entries(data as Record<string, unknown>)) {
    const p = value as { x?: unknown; y?: unknown } | null;
    if (p && typeof p.x === "number" && typeof p.y === "number" && Number.isFinite(p.x) && Number.isFinite(p.y)) {
      out[id] = { x: Math.round(p.x), y: Math.round(p.y) };
    }
  }
  return out;
}

async function readView(repoRoot: string, view: ViewKey): Promise<Positions> {
  try {
    return sanitize(parse(await readFile(join(repoRoot, LAYOUT_DIR, `${view}.yaml`), "utf8")));
  } catch {
    return {};
  }
}

export async function readLayout(repoRoot: string): Promise<Layout> {
  const layout = emptyLayout();
  for (const view of VIEW_KEYS) layout[view] = await readView(repoRoot, view);
  return layout;
}

export async function writeLayoutView(repoRoot: string, view: ViewKey, positions: Positions): Promise<Positions> {
  const merged = { ...(await readView(repoRoot, view)), ...sanitize(positions) };
  const sorted = Object.fromEntries(Object.keys(merged).sort().map((id) => [id, merged[id]]));
  await mkdir(join(repoRoot, LAYOUT_DIR), { recursive: true });
  await writeFile(join(repoRoot, LAYOUT_DIR, `${view}.yaml`), stringify(sorted, { lineWidth: 0 }), "utf8");
  return sorted;
}
```

- [ ] **Step 4: ストアに setLayout と exclusive を追加する**

`rdra-server/src/store.ts` の import に追加する:

```ts
import { writeLayoutView } from "./layout.js";
import type { Positions, ViewKey } from "./model/view-keys.js";
```

`watch(): void {` の直前に追加する:

```ts
  setLayout(view: ViewKey, positions: Positions): Promise<Positions> {
    return this.enqueue(async () => {
      const merged = await writeLayoutView(this.repoRoot, view, positions);
      this.emit("layout", { view });
      this.startWatcher();
      return merged;
    });
  }

  exclusive<T>(fn: () => Promise<T>): Promise<T> {
    return this.enqueue(fn);
  }

```

- [ ] **Step 5: upsert で null を削除として扱う**

`rdra-server/src/operations.ts` の `upsert` 関数内で、

```ts
  const merged = index >= 0 ? { ...list[index], ...patch } : patch;
```

を次に置き換える:

```ts
  const merged: Record<string, unknown> = index >= 0 ? { ...list[index], ...patch } : { ...patch };
  for (const key of Object.keys(merged)) if (merged[key] === null) delete merged[key];
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run && npx tsc -p .`
Expected: すべて PASS（layout 3 件、operations 11 件を含む）、tsc はエラーなし

- [ ] **Step 7: コミットする**

```bash
git add rdra-server/src/model/view-keys.ts rdra-server/src/layout.ts rdra-server/src/store.ts rdra-server/src/operations.ts rdra-server/test/layout.test.ts rdra-server/test/operations.test.ts
git commit -m "Add per-view layout storage and null field removal in upsert"
```

---

### Task 2: 分岐点との差分の共通化と、レビュー依頼の通知

**Files:**
- Create: `rdra-server/src/base-diff.ts`
- Modify: `rdra-server/src/mcp.ts`
- Modify: `rdra-server/test/mcp.test.ts`

**Interfaces:**
- Consumes: `diffModels`（計画 1 Task 5）、`resolveBaseCommit`, `readModelFilesAt`（計画 1 Task 6）、`parseModel`（計画 1 Task 2）
- Produces:
  - `interface BaseDiff { base: string | null; changes: ElementChange[] }`
  - `diffAgainstBase(repoRoot: string, model: Model): Promise<BaseDiff>`（分岐点がなければ `{ base: null, changes: [] }`。分岐点側の YAML が壊れていれば `ModelParseError` を投げる）
  - `McpDeps.onReviewChange?: () => void`（`rdra_request_review` がレビュー記録を書いた直後に呼ぶ。Task 4 で WebSocket 通知につなぐ）

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/mcp.test.ts` の `connect` 関数を次に置き換える:

```ts
async function connect(repo: string, env: NodeJS.ProcessEnv = {}, onReviewChange?: () => void) {
  const store = await RdraStore.open(repo);
  cleanups.push(() => store.close());
  const server = createMcpServer({
    store,
    index: new QueryIndex(),
    reviewUrl: () => "http://127.0.0.1:1234/",
    now: () => "2026-09-25T10:00:00+09:00",
    env,
    onReviewChange,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: res.isError === true, text: res.content[0].text, json: () => JSON.parse(res.content[0].text) };
  };
  return { store, call, client };
}
```

`it("requests a review and reports its status", ...)` の中の

```ts
    const { call } = await connect(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/001-demo" });
    const res = (await call("rdra_request_review")).json();
    expect(res).toMatchObject({ status: "pending", url: null });
```

を次に置き換える:

```ts
    let notified = 0;
    const { call } = await connect(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/001-demo" }, () => (notified += 1));
    const res = (await call("rdra_request_review")).json();
    expect(res).toMatchObject({ status: "pending", url: "http://127.0.0.1:1234/" });
    expect(notified).toBe(1);
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/mcp.test.ts`
Expected: FAIL（`expected 0 to be 1`。`onReviewChange` がまだ呼ばれない）

- [ ] **Step 3: 共通の差分関数を作る**

`rdra-server/src/base-diff.ts`:

```ts
import { diffModels, type ElementChange } from "./diff.js";
import { readModelFilesAt, resolveBaseCommit } from "./git.js";
import { parseModel } from "./model/io.js";
import type { Model } from "./model/kinds.js";

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
```

- [ ] **Step 4: MCP を差し替える**

`rdra-server/src/mcp.ts` を次の内容に置き換える（変更点: `rdra_diff` が `diffAgainstBase` を使う、`McpDeps.onReviewChange` を追加し `rdra_request_review` の保存後に呼ぶ）:

`rdra-server/src/mcp.ts`:

```ts
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { diffAgainstBase } from "./base-diff.js";
import { resolveFeatureDir } from "./feature.js";
import { resolveBaseCommit } from "./git.js";
import { ModelParseError } from "./model/io.js";
import { KIND_KEYS } from "./model/kinds.js";
import { RELATION_KINDS } from "./model/relations.js";
import type { Operation } from "./operations.js";
import type { QueryIndex } from "./query.js";
import { REVIEW_FILE, approvalState, readReview, requestReview, writeReview } from "./review.js";
import type { RdraStore } from "./store.js";
import { hasErrors, validate } from "./validate.js";
import { SERVER_VERSION } from "./version.js";

export interface McpDeps {
  store: RdraStore;
  index: QueryIndex;
  reviewUrl: () => string | null;
  now?: () => string;
  env?: NodeJS.ProcessEnv;
  onReviewChange?: () => void;
}

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

const json = (value: unknown): ToolResult => ({ content: [{ type: "text", text: JSON.stringify(value, null, 2) }] });
const fail = (message: string): ToolResult => ({ content: [{ type: "text", text: message }], isError: true });

const linkShape = z.object({
  relation: z.enum(RELATION_KINDS),
  from: z.string(),
  to: z.string(),
});

export function createMcpServer(deps: McpDeps): McpServer {
  const { store, index } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const env = deps.env ?? process.env;
  const server = new McpServer({ name: "geass-rdra", version: SERVER_VERSION });

  const applyTool = async (ops: Operation[]): Promise<ToolResult> => {
    const result = await store.apply(ops);
    return result.ok ? json(result) : fail(`${result.reason}: ${result.message}`);
  };

  server.registerTool(
    "rdra_get_model",
    {
      description: "RDRA モデル（docs/rdra）を取得する。kind を指定するとその種別だけを返す。",
      inputSchema: { kind: z.enum(KIND_KEYS).optional() },
    },
    async ({ kind }) => {
      const model = store.model;
      return json({
        version: store.version,
        parseError: store.parseError?.message ?? null,
        model: kind ? { [kind]: model[kind] } : model,
      });
    },
  );

  server.registerTool(
    "rdra_query",
    {
      description:
        "RDRA モデルに読み取り専用の SQL で問い合わせる。テーブル: elements(id, kind, name, description, data), relations(from_id, to_id, kind, attrs), state_nodes(model_id, state_id, name), state_transitions(model_id, from_state, to_state, ref)。種別ごとのビュー: actors, external_systems, bucs, usecases, screens, events, information, state_models。",
      inputSchema: { sql: z.string().min(1) },
    },
    async ({ sql }) => {
      try {
        index.rebuild(store.model);
        return json(index.query(sql));
      } catch (e) {
        return fail(`SQL エラー: ${(e as Error).message}`);
      }
    },
  );

  server.registerTool(
    "rdra_validate",
    { description: "RDRA モデルの整合性チェック。error はレビュー依頼を妨げ、warning は妨げない。", inputSchema: {} },
    async () => json({ parseError: store.parseError?.message ?? null, issues: validate(store.model) }),
  );

  server.registerTool(
    "rdra_diff",
    { description: "feature ブランチの分岐点と比べた、要素単位の差分。", inputSchema: {} },
    async () => {
      try {
        const diff = await diffAgainstBase(store.repoRoot, store.model);
        if (!diff.base) return json({ ...diff, note: "比較対象の分岐点コミットが見つからないため、差分は計算できません" });
        return json(diff);
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点の RDRA を読めません: ${e.message}`);
        throw e;
      }
    },
  );

  server.registerTool(
    "rdra_upsert",
    {
      description:
        "要素を追加または更新する（既存 ID なら指定したフィールドだけを上書き）。kind: actors, externalSystems, bucs, usecases, screens, events, information, states。ID は <接頭辞>.<スラッグ>（act, ext, buc, uc, scr, evt, inf, st）。",
      inputSchema: {
        items: z.array(z.object({ kind: z.enum(KIND_KEYS), element: z.record(z.string(), z.unknown()) })).min(1),
      },
    },
    async ({ items }) => applyTool(items.map((i) => ({ op: "upsert", kind: i.kind, element: i.element }))),
  );

  server.registerTool(
    "rdra_delete",
    { description: "要素を削除する。その要素を参照している関連も同時に外れ、removedRelations に返る。", inputSchema: { ids: z.array(z.string()).min(1) } },
    async ({ ids }) => applyTool(ids.map((id) => ({ op: "delete", id }))),
  );

  server.registerTool(
    "rdra_link",
    {
      description:
        "関連を張る。relation は起点の種別で決まる（例: uc.screen は uc -> scr）。uc.information には attrs.access（create/read/update/delete）が必要。uc.transition の to は st.<モデル>:<状態>-><状態>。inf.related には任意で attrs.label。",
      inputSchema: {
        links: z.array(linkShape.extend({ attrs: z.record(z.string(), z.string()).optional() })).min(1),
      },
    },
    async ({ links }) => applyTool(links.map((l) => ({ op: "link", relation: l.relation, from: l.from, to: l.to, attrs: l.attrs }))),
  );

  server.registerTool(
    "rdra_unlink",
    { description: "関連を外す。", inputSchema: { links: z.array(linkShape).min(1) } },
    async ({ links }) => applyTool(links.map((l) => ({ op: "unlink", relation: l.relation, from: l.from, to: l.to }))),
  );

  server.registerTool(
    "rdra_request_review",
    {
      description:
        "現在の RDRA モデルについて人間のレビューを依頼する（状態を pending にする）。エラーが 1 件でもあると依頼できない。承認・差し戻しはレビュー画面で人間だけが行う。",
      inputSchema: {},
    },
    async () => {
      const featureDir = await resolveFeatureDir(store.repoRoot, env);
      if (!featureDir) {
        return fail("feature の外ではレビューを依頼できません。feature の worktree で実行するか、.geass/feature.json を設定してください");
      }
      if (store.parseError) return fail(`YAML にエラーがあります: ${store.parseError.message}`);
      const issues = validate(store.model);
      if (hasErrors(issues)) {
        const errors = issues.filter((i) => i.level === "error").map((i) => `- ${i.message}`);
        return fail(`エラーを解消してからレビューを依頼してください:\n${errors.join("\n")}`);
      }
      const record = requestReview(await readReview(featureDir), {
        now: now(),
        baseCommit: await resolveBaseCommit(store.repoRoot),
      });
      await writeReview(featureDir, record);
      deps.onReviewChange?.();
      return json({ status: record.status, url: deps.reviewUrl(), reviewFile: join(featureDir, REVIEW_FILE) });
    },
  );

  server.registerTool(
    "rdra_review_status",
    { description: "レビューの状態（none / pending / approved / rejected）と、最後の判断のコメント。approval が stale なら承認後にモデルが変更されている。", inputSchema: {} },
    async () => {
      const featureDir = await resolveFeatureDir(store.repoRoot, env);
      if (!featureDir) return json({ status: "none", approval: "none", lastRound: null, url: deps.reviewUrl(), note: "feature の外です" });
      const record = await readReview(featureDir);
      return json({
        status: record.status,
        approval: approvalState(record, store.version).state,
        lastRound: record.rounds.at(-1) ?? null,
        url: deps.reviewUrl(),
      });
    },
  );

  return server;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/mcp.test.ts && npx tsc -p .`
Expected: PASS（7 件）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/src/base-diff.ts rdra-server/src/mcp.ts rdra-server/test/mcp.test.ts
git commit -m "Share base-commit diff and notify on review requests"
```

---

### Task 3: HTTP API と WebSocket

**Files:**
- Modify: `rdra-server/package.json`（`ws` を追加）
- Create: `rdra-server/src/http.ts`
- Test: `rdra-server/test/http.test.ts`

**Interfaces:**
- Consumes: `RdraStore`（`apply`, `setLayout`, `exclusive`, `"change"` / `"layout"` イベント）、`diffAgainstBase`（Task 2）、`readLayout`, `isViewKey`（Task 1）、`resolveFeatureDir`（計画 1 Task 6）、`readReview`, `writeReview`, `decide`, `approvalState`, `ReviewError`（計画 1 Task 10）、`validate`, `hasErrors`（計画 1 Task 4）
- Produces:
  - `interface HttpDeps { store: RdraStore; reviewEvents: EventEmitter; webRoot: string | null; env?: NodeJS.ProcessEnv; now?: () => string }`
  - `interface RdraHttp { url: string; close(): Promise<void> }`（`url` は末尾 `/` 付き）
  - `startHttp(deps: HttpDeps, port = 0): Promise<RdraHttp>`
  - API:

| メソッドとパス | 内容 | 応答 |
|---|---|---|
| `GET /api/state` | 版、構文エラー、モデル、検証結果、レイアウト、feature ディレクトリ、レビュー記録、承認状態 | 200 |
| `GET /api/diff` | `{ base, changes }`（分岐点側の YAML が壊れていれば `base: null` と `note`） | 200 |
| `POST /api/ops` | `{ expectedVersion, ops }` を `store.apply` に渡す | 200 / 409（conflict）/ 422 |
| `PUT /api/layout/:view` | `{ positions }` を保存 | 204 / 404（不明なビュー） |
| `POST /api/review/decision` | `{ decision, comments, version }` | 200 `{ review }` / 404（feature の外）/ 409（版の不一致）/ 422（エラーあり、pending でない、コメントなしの差し戻し） |
| `GET /ws` | WebSocket。`{ type: "model" }` / `{ type: "layout" }` / `{ type: "review" }` を送る | |
| それ以外の GET | `webRoot` の静的ファイル。拡張子のないパスは `index.html`。ビルドされていなければ 503 | |

- [ ] **Step 1: 依存を追加する**

Run: `cd rdra-server && npm install ws@^8.21.3 && npm install -D @types/ws@^8.18.1`
Expected: `package.json` の `dependencies` に `ws`、`devDependencies` に `@types/ws` が入る

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/http.test.ts`:

```ts
import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { startHttp, type RdraHttp } from "../src/http.js";
import { RDRA_DIR } from "../src/model/io.js";
import { REVIEW_FILE, emptyReview, requestReview, writeReview } from "../src/review.js";
import { RdraStore } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeRepo, run } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const FEATURE = "specs/001-demo";
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(opts: { webRoot?: string | null; feature?: boolean } = {}) {
  const repo = await makeRepo(rdraFiles());
  const store = await RdraStore.open(repo);
  const reviewEvents = new EventEmitter();
  const env = opts.feature === false ? {} : { SPECIFY_FEATURE_DIRECTORY: FEATURE };
  const http: RdraHttp = await startHttp({
    store,
    reviewEvents,
    webRoot: opts.webRoot ?? null,
    env,
    now: () => "2026-09-25T10:00:00+09:00",
  });
  cleanups.push(() => store.close(), () => http.close());
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-rdra-client": "web" }) => {
    const res = await fetch(new URL(path, http.url), {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const isJson = res.headers.get("content-type")?.startsWith("application/json") ?? false;
    return { status: res.status, body: isJson ? JSON.parse(text) : null, text };
  };
  return { repo, store, http, call, reviewEvents, featureDir: join(repo, FEATURE) };
}

describe("HTTP API", () => {
  it("serves the current state", async () => {
    const { call, store } = await setup();
    const { status, body } = await call("GET", "/api/state");
    expect(status).toBe(200);
    expect(body).toMatchObject({ version: store.version, parseError: null, approval: "none", review: { status: "none" } });
    expect(body.model.usecases[0].id).toBe("uc.place-order");
    expect(body.issues).toEqual([]);
    expect(body.layout["usecase-composite"]).toEqual({});
  });

  it("applies operations with optimistic locking", async () => {
    const { call, store, repo } = await setup();
    const op = { op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } };
    expect((await call("POST", "/api/ops", { expectedVersion: "sha256:stale", ops: [op] })).status).toBe(409);
    const ok = await call("POST", "/api/ops", { expectedVersion: store.version, ops: [op] });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(await readFile(join(repo, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.top");
    const bad = await call("POST", "/api/ops", { ops: [{ op: "delete", id: "scr.none" }] });
    expect(bad.status).toBe(422);
  });

  it("rejects mutations without the client header or from foreign hosts", async () => {
    const { call, http } = await setup();
    expect((await call("POST", "/api/ops", { ops: [] }, {})).status).toBe(403);
    const port = Number(new URL(http.url).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/state", headers: { host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("saves layout per view", async () => {
    const { call } = await setup();
    expect((await call("PUT", "/api/layout/information-model", { positions: { "inf.order": { x: 3, y: 4 } } })).status).toBe(204);
    expect((await call("GET", "/api/state")).body.layout["information-model"]).toEqual({ "inf.order": { x: 3, y: 4 } });
    expect((await call("PUT", "/api/layout/nope", { positions: {} })).status).toBe(404);
  });

  it("returns the diff against the base commit", async () => {
    const { call, store, repo } = await setup();
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    run(repo, "git", ["config", "branch.20260925-120000-demo.geass-base-commit", run(repo, "git", ["rev-parse", "HEAD"]).trim()]);
    await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    const { body } = await call("GET", "/api/diff");
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual(["scr.top"]);
  });

  it("records decisions only for pending reviews at the current version", async () => {
    const { call, store, featureDir, reviewEvents } = await setup();
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version })).status).toBe(422);

    await writeReview(featureDir, requestReview(emptyReview(), { now: "t", baseCommit: null }));
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: "sha256:old" })).status).toBe(409);
    expect((await call("POST", "/api/review/decision", { decision: "rejected", comments: [], version: store.version })).status).toBe(422);

    let notified = 0;
    reviewEvents.on("review", () => (notified += 1));
    const rejected = await call("POST", "/api/review/decision", {
      decision: "rejected",
      comments: [{ target: "uc.place-order", text: "在庫の扱いを書いて" }],
      version: store.version,
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.review.status).toBe("rejected");
    expect(notified).toBe(1);

    await writeReview(featureDir, requestReview(rejected.body.review, { now: "t", baseCommit: null }));
    const approved = await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version });
    expect(approved.status).toBe(200);
    const record = JSON.parse(await readFile(join(featureDir, REVIEW_FILE), "utf8"));
    expect(record).toMatchObject({ status: "approved", approved_hash: store.version });
    expect(record.rounds).toHaveLength(2);
  });

  it("refuses approval while errors remain", async () => {
    const { call, store, repo, featureDir } = await setup();
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "[]\n");
    await store.reload();
    await writeReview(featureDir, requestReview(emptyReview(), { now: "t", baseCommit: null }));
    const res = await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("エラー");
  });

  it("refuses decisions outside a feature", async () => {
    const { call, store } = await setup({ feature: false });
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version })).status).toBe(404);
  });

  it("pushes change notifications over WebSocket", async () => {
    const { http, store } = await setup();
    const ws = new WebSocket(new URL("/ws", http.url.replace("http", "ws")));
    await new Promise((resolve) => ws.once("open", resolve));
    const message = new Promise<string>((resolve) => ws.once("message", (data) => resolve(String(data))));
    await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    expect(JSON.parse(await message)).toEqual({ type: "model" });
    ws.close();
  });

  it("serves the web app with an SPA fallback and blocks traversal", async () => {
    const { repo } = await setup();
    const webRoot = join(repo, "web-dist");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<html>rdra</html>");
    await writeFile(join(webRoot, "assets", "app.js"), "console.log(1)");
    const { call } = await setup({ webRoot });
    expect((await call("GET", "/")).text).toBe("<html>rdra</html>");
    expect((await call("GET", "/some/route")).text).toBe("<html>rdra</html>");
    expect((await call("GET", "/assets/app.js")).text).toBe("console.log(1)");
    expect((await call("GET", "/assets/missing.js")).status).toBe(404);
    expect((await call("GET", "/../../etc/passwd.js")).status).not.toBe(200);
  });

  it("explains when the web app is not built", async () => {
    const { call } = await setup();
    const res = await call("GET", "/");
    expect(res.status).toBe(503);
    expect(res.text).toContain("ビルドされていません");
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/http.test.ts`
Expected: FAIL（`../src/http.js` が見つからない）

- [ ] **Step 4: 実装する**

`rdra-server/src/http.ts`:

```ts
import type { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { diffAgainstBase } from "./base-diff.js";
import { resolveFeatureDir } from "./feature.js";
import { readLayout } from "./layout.js";
import { ModelParseError } from "./model/io.js";
import { isViewKey, type Positions } from "./model/view-keys.js";
import type { Operation } from "./operations.js";
import { ReviewError, approvalState, decide, readReview, writeReview, type ReviewComment } from "./review.js";
import type { RdraStore } from "./store.js";
import { hasErrors, validate } from "./validate.js";

export interface HttpDeps {
  store: RdraStore;
  reviewEvents: EventEmitter;
  webRoot: string | null;
  env?: NodeJS.ProcessEnv;
  now?: () => string;
}

export interface RdraHttp {
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function allowedHost(req: IncomingMessage): boolean {
  return /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "リクエストが大きすぎます");
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON を解釈できません");
  }
}

export async function startHttp(deps: HttpDeps, port = 0): Promise<RdraHttp> {
  const { store, reviewEvents, webRoot } = deps;
  const env = deps.env ?? process.env;
  const now = deps.now ?? (() => new Date().toISOString());
  const sockets = new Set<WebSocket>();

  const broadcast = (message: unknown) => {
    const text = JSON.stringify(message);
    for (const socket of sockets) socket.send(text);
  };
  const onModel = () => broadcast({ type: "model" });
  const onLayout = () => broadcast({ type: "layout" });
  const onReview = () => broadcast({ type: "review" });
  store.on("change", onModel);
  store.on("layout", onLayout);
  reviewEvents.on("review", onReview);

  async function state() {
    const featureDir = await resolveFeatureDir(store.repoRoot, env);
    const review = featureDir ? await readReview(featureDir) : null;
    return {
      version: store.version,
      parseError: store.parseError?.message ?? null,
      model: store.model,
      issues: validate(store.model),
      layout: await readLayout(store.repoRoot),
      featureDir,
      review,
      approval: review ? approvalState(review, store.version).state : "none",
    };
  }

  async function diff() {
    try {
      return await diffAgainstBase(store.repoRoot, store.model);
    } catch (e) {
      if (e instanceof ModelParseError) return { base: null, changes: [], note: `分岐点の RDRA を読めません: ${e.message}` };
      throw e;
    }
  }

  async function applyOps(body: Record<string, unknown>, res: ServerResponse) {
    if (!Array.isArray(body.ops)) throw new HttpError(400, "ops が必要です");
    const result = await store.apply(body.ops as Operation[], {
      expectedVersion: typeof body.expectedVersion === "string" ? body.expectedVersion : undefined,
    });
    sendJson(res, result.ok ? 200 : result.reason === "conflict" ? 409 : 422, result);
  }

  async function saveLayout(view: string, body: Record<string, unknown>, res: ServerResponse) {
    if (!isViewKey(view)) throw new HttpError(404, `不明なビュー: ${view}`);
    await store.setLayout(view, (body.positions ?? {}) as Positions);
    res.writeHead(204).end();
  }

  async function decideReview(body: Record<string, unknown>, res: ServerResponse) {
    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected") throw new HttpError(400, "decision は approved か rejected です");
    const comments = (Array.isArray(body.comments) ? body.comments : []) as ReviewComment[];
    const featureDir = await resolveFeatureDir(store.repoRoot, env);
    if (!featureDir) throw new HttpError(404, "feature の外ではレビューできません");
    const record = await store.exclusive(async () => {
      if (body.version !== store.version) throw new HttpError(409, "レビュー中にモデルが変更されました。最新の状態を確認してください");
      if (decision === "approved" && (store.parseError || hasErrors(validate(store.model)))) {
        throw new HttpError(422, "エラーが残っているため承認できません");
      }
      try {
        const next = decide(await readReview(featureDir), { decision, comments, hash: store.version, now: now() });
        await writeReview(featureDir, next);
        return next;
      } catch (e) {
        if (e instanceof ReviewError) throw new HttpError(422, e.message);
        throw e;
      }
    });
    reviewEvents.emit("review");
    sendJson(res, 200, { review: record });
  }

  async function serveStatic(pathname: string, res: ServerResponse) {
    if (!webRoot) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("Web UI がビルドされていません");
      return;
    }
    const root = normalize(webRoot);
    const requested = normalize(join(root, decodeURIComponent(pathname)));
    const file = requested.startsWith(root + sep) && extname(requested) ? requested : join(root, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      if (file.endsWith("index.html")) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("Web UI がビルドされていません");
      } else {
        res.writeHead(404).end();
      }
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!allowedHost(req)) throw new HttpError(403, "許可されていないホストです");
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (method !== "GET" && req.headers["x-rdra-client"] !== "web") throw new HttpError(403, "x-rdra-client ヘッダーが必要です");

    if (method === "GET" && pathname === "/api/state") return sendJson(res, 200, await state());
    if (method === "GET" && pathname === "/api/diff") return sendJson(res, 200, await diff());
    if (method === "POST" && pathname === "/api/ops") return applyOps(await readJson(req), res);
    if (method === "PUT" && pathname.startsWith("/api/layout/")) {
      return saveLayout(pathname.slice("/api/layout/".length), await readJson(req), res);
    }
    if (method === "POST" && pathname === "/api/review/decision") return decideReview(await readJson(req), res);
    if (pathname.startsWith("/api/")) throw new HttpError(404, "見つかりません");
    if (method === "GET") return serveStatic(pathname, res);
    throw new HttpError(405, "許可されていないメソッドです");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) sendJson(res, e.status, { message: e.message });
      else sendJson(res, 500, { message: (e as Error).message });
    });
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws" || !allowedHost(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("close", () => sockets.delete(ws));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actualPort } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${actualPort}/`,
    close: async () => {
      store.off("change", onModel);
      store.off("layout", onLayout);
      reviewEvents.off("review", onReview);
      for (const socket of sockets) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/http.test.ts && npx tsc -p .`
Expected: PASS（11 件）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/package.json rdra-server/package-lock.json rdra-server/src/http.ts rdra-server/test/http.test.ts
git commit -m "Add local HTTP API and WebSocket notifications for RDRA review"
```

---

### Task 4: サーバーへの組み込みと serve コマンド

**Files:**
- Modify: `rdra-server/src/server.ts`
- Create: `rdra-server/src/serve.ts`
- Modify: `rdra-server/src/cli.ts`
- Modify: `rdra-server/build.mjs`

**Interfaces:**
- Consumes: `startHttp`（Task 3）、`createMcpServer`（Task 2 の `onReviewChange` 付き）
- Produces:
  - `bundledWebRoot(): string`（バンドルされた JS と同じ階層の `web/`。つまり `dist/web`）
  - MCP の `rdra_request_review` と `rdra_review_status` が返す `url` が実際のレビュー画面の URL になる
  - CLI `serve --repo <root> [--port 0]`: MCP なしで HTTP だけを起動し、`{"url": "..."}` を 1 行出力して SIGINT/SIGTERM まで動く（E2E テストと、手動での確認用）

この Task の動作確認は Task 7 の `dist.test.ts` と E2E で行う（Web アプリのビルドが必要なため）。ここでは型検査と既存テストが通ることを確認する。

- [ ] **Step 1: server.ts を置き換える**

`rdra-server/src/server.ts`:

```ts
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repoRootOf } from "./git.js";
import { startHttp } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { QueryIndex } from "./query.js";
import { RdraStore } from "./store.js";

export function bundledWebRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "web");
}

export async function startServer(): Promise<void> {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const repoRoot = (await repoRootOf(cwd)) ?? cwd;
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const reviewEvents = new EventEmitter();
  const http = await startHttp({ store, reviewEvents, webRoot: bundledWebRoot() });
  const server = createMcpServer({
    store,
    index: new QueryIndex(),
    reviewUrl: () => http.url,
    onReviewChange: () => reviewEvents.emit("review"),
  });
  await server.connect(new StdioServerTransport());
}
```

- [ ] **Step 2: serve コマンドを追加する**

`rdra-server/src/serve.ts`:

```ts
import { EventEmitter } from "node:events";
import type { CliIo } from "./cli.js";
import { startHttp } from "./http.js";
import { bundledWebRoot } from "./server.js";
import { RdraStore } from "./store.js";

export async function serve(repoRoot: string, port: number, io: CliIo): Promise<number> {
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const http = await startHttp({ store, reviewEvents: new EventEmitter(), webRoot: bundledWebRoot() }, port);
  io.out(JSON.stringify({ url: http.url }) + "\n");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await http.close();
  store.close();
  return 0;
}
```

`rdra-server/src/cli.ts` を 3 か所変更する。

`USAGE` の `"  cli.js hash --repo <root>",` の次の行に追加:

```ts
  "  cli.js serve --repo <root> [--port 0]",
```

`parseArgs` の `options` の `"timeout-sec": { type: "string" },` の次の行に追加:

```ts
        port: { type: "string" },
```

`if (command === "hash" && repo) {` の直前に追加:

```ts
  if (command === "serve" && repo) {
    const { serve } = await import("./serve.js");
    return serve(repo, Number(values.port ?? "0"), io);
  }
```

- [ ] **Step 3: ws のオプション依存をバンドル対象から外す**

`rdra-server/build.mjs` の esbuild のオプションに `external: ["bufferutil", "utf-8-validate"],` を追加する（`ws` は存在すれば使う任意の依存で、ないと esbuild が解決に失敗するため）。Web のビルドは Task 6 で追加する。

- [ ] **Step 4: 確認する**

Run: `cd rdra-server && npx tsc -p . && npx vitest run`
Expected: すべて PASS。`dist.test.ts` もこの時点では通る（Web のビルドはまだ含まれない）

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/server.ts rdra-server/src/serve.ts rdra-server/src/cli.ts rdra-server/build.mjs
git commit -m "Start the review HTTP server alongside MCP and add a serve command"
```

---

### Task 5: Web アプリの土台と、図への投影・関連の推定

**Files:**
- Modify: `rdra-server/package.json`（React ほかを追加、scripts を更新）
- Create: `rdra-server/vite.config.ts`
- Create: `rdra-server/vitest.config.ts`
- Create: `rdra-server/web/tsconfig.json`
- Create: `rdra-server/web/src/views.ts`
- Create: `rdra-server/web/src/infer.ts`
- Test: `rdra-server/test/web-views.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `emptyModel`, `kindOfId`（計画 1 Task 1）、`relationsOf`, `parseTransitionRef`, `RelationKind`（計画 1 Task 4）、`ElementChange`（計画 1 Task 5）、`ViewKey`（Task 1）
- Produces（`web/src/views.ts`）:
  - `type ChangeStatus = "added" | "modified" | "removed"`
  - `interface DiagramNode { id; type; label; elementId; parent?; status? }`（`type` は接頭辞。ほかに `"system"` と `"state"`）
  - `interface DiagramEdge { id; source; target; label?; relation?; from?; to?; status?: "added" | "removed" }`（`relation` がある線だけが外せる。状態遷移の線は `id` が `tr|` で始まり、`from` に状態モデル ID、`to` に遷移参照）
  - `interface Diagram { nodes; edges }`
  - `projectView(view: ViewKey, model: Model, changes?: ElementChange[]): Diagram`
  - `viewForId(id: string): ViewKey`、`stateNodeId(modelId, stateId): string`（`st.order:draft`）、`SYSTEM_NODE_ID = "system"`
- Produces（`web/src/infer.ts`）:
  - `interface LinkIntent { relation; from; to; attrs? }`、`inferLink(a, b): LinkIntent | null`（ドラッグの向きに関係なく正しい向きの関連を返す。`uc.information` は `access: "read"` を既定にする）
  - `interface TransitionIntent { model; from; to }`、`inferTransition(a, b): TransitionIntent | null`（同じ状態モデル内の 2 状態のとき）
  - `relationsFrom(prefix): { relation; targetPrefix }[]`（インスペクターの「関連を追加」用）

ビューごとの投影:

| ビュー | ノード | 線 |
|---|---|---|
| system-context | アクター、外部システム、システム | 各アクター・外部システム → システム（ラベルはそれが関わるイベント名） |
| business-flow | BUC、アクター、ユースケース | `buc.actor`, `buc.usecase` |
| usecase-composite | ユースケース、アクター、画面、イベント、情報、外部システム、状態モデル | `uc.*`（遷移は状態モデルへの線で、ラベルは `from→to`）、`evt.source`, `evt.target` |
| information-model | 情報 | `inf.related` |
| state-model | 状態モデル（グループ）とその状態 | 遷移（ラベルはその遷移を起こすユースケース名） |

差分の表示: 追加・変更された要素は `status` を付け、削除された要素は変更前の内容から `status: "removed"` の幽霊ノードとして出す。変更された要素の関連は、変更前後を比べて追加分に `added`、消えた分を `removed` の幽霊線として出す。

- [ ] **Step 1: 依存と設定を追加する**

Run:

```bash
cd rdra-server
npm install -D react@^19.3.0 react-dom@^19.3.0 @types/react@^19.3.0 @types/react-dom@^19.3.0 @xyflow/react@^12.12.0 elkjs@^0.12.0 vite@^8.3.1 @vitejs/plugin-react@^6.1.1 @playwright/test@^1.63.0
```

Web の依存はすべて `dist/web` にバンドルされるので devDependencies に入れる。

`rdra-server/package.json` の `scripts` を次に置き換える:

```json
  "scripts": {
    "test": "vitest run",
    "test:e2e": "playwright test",
    "typecheck": "tsc -p . && tsc -p web",
    "build": "node build.mjs",
    "dev:web": "vite"
  },
```

`rdra-server/vite.config.ts`:

```ts
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const target = `http://127.0.0.1:${process.env.RDRA_PORT ?? "4178"}`;

export default defineConfig({
  root: "web",
  base: "./",
  plugins: [react()],
  build: { outDir: "../dist/web", emptyOutDir: true, chunkSizeWarningLimit: 4000 },
  server: {
    proxy: {
      "/api": target,
      "/ws": { target: target.replace("http", "ws"), ws: true },
    },
  },
});
```

`vite.config.ts` は `root: "web"` なので、vitest がこれを読むとテストを見つけられなくなる。テスト用の設定を別に置く:

`rdra-server/vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { include: ["test/**/*.test.ts"] },
});
```

`rdra-server/web/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "lib": ["ES2023", "DOM", "DOM.Iterable"],
    "types": ["node", "vite/client"]
  },
  "include": ["src"]
}
```

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/web-views.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { parseModel } from "../src/model/io.js";
import { inferLink, inferTransition, relationsFrom } from "../web/src/infer.js";
import { projectView, viewForId } from "../web/src/views.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("projectView", () => {
  it("draws the system context with a system node and event labels", () => {
    const d = projectView("system-context", sampleModel());
    expect(ids(d.nodes)).toEqual(["act.customer", "ext.payment-gateway", "system"]);
    expect(d.edges.find((e) => e.source === "ext.payment-gateway")).toMatchObject({ target: "system", label: "決済依頼" });
  });

  it("draws the business flow from BUC relations", () => {
    const d = projectView("business-flow", sampleModel());
    expect(ids(d.nodes)).toEqual(["act.customer", "buc.ordering", "uc.place-order"]);
    expect(d.edges.map((e) => e.relation).sort()).toEqual(["buc.actor", "buc.usecase"]);
  });

  it("draws the usecase composite with access labels and transitions onto the state model", () => {
    const d = projectView("usecase-composite", sampleModel());
    expect(d.edges.find((e) => e.relation === "uc.information")).toMatchObject({ target: "inf.order", label: "create" });
    expect(d.edges.find((e) => e.relation === "uc.transition")).toMatchObject({ target: "st.order", label: "draft→placed" });
    expect(d.edges.find((e) => e.relation === "evt.target")).toMatchObject({ source: "evt.payment-request", target: "ext.payment-gateway" });
  });

  it("draws state models as groups of states with transitions labelled by usecases", () => {
    const d = projectView("state-model", sampleModel());
    expect(d.nodes.map((n) => `${n.id}|${n.parent ?? ""}`)).toEqual(["st.order|", "st.order:draft|st.order", "st.order:placed|st.order"]);
    expect(d.edges).toEqual([
      expect.objectContaining({ source: "st.order:draft", target: "st.order:placed", label: "注文する", to: "st.order:draft->placed" }),
    ]);
  });

  it("marks added, modified and removed elements and relations", () => {
    const files = sampleFiles();
    files["screens.yaml"] = "- id: scr.confirm\n  name: 確認\n";
    files["usecases.yaml"] = files["usecases.yaml"].replace("screens: [scr.cart]", "screens: [scr.confirm]");
    const head = parseModel(files);
    const d = projectView("usecase-composite", head, diffModels(sampleModel(), head));
    expect(d.nodes.find((n) => n.id === "scr.confirm")?.status).toBe("added");
    expect(d.nodes.find((n) => n.id === "scr.cart")?.status).toBe("removed");
    expect(d.nodes.find((n) => n.id === "uc.place-order")?.status).toBe("modified");
    expect(d.edges.find((e) => e.target === "scr.confirm")?.status).toBe("added");
    expect(d.edges.find((e) => e.target === "scr.cart")?.status).toBe("removed");
  });

  it("maps ids to their home view", () => {
    expect(viewForId("act.a")).toBe("system-context");
    expect(viewForId("buc.a")).toBe("business-flow");
    expect(viewForId("scr.a")).toBe("usecase-composite");
    expect(viewForId("inf.a")).toBe("information-model");
    expect(viewForId("st.a")).toBe("state-model");
  });
});

describe("inferLink", () => {
  it("orients relations regardless of drag direction", () => {
    expect(inferLink("uc.a", "scr.b")).toEqual({ relation: "uc.screen", from: "uc.a", to: "scr.b" });
    expect(inferLink("scr.b", "uc.a")).toEqual({ relation: "uc.screen", from: "uc.a", to: "scr.b" });
    expect(inferLink("act.x", "buc.y")).toEqual({ relation: "buc.actor", from: "buc.y", to: "act.x" });
  });

  it("defaults information access to read and handles event direction", () => {
    expect(inferLink("inf.o", "uc.a")).toEqual({ relation: "uc.information", from: "uc.a", to: "inf.o", attrs: { access: "read" } });
    expect(inferLink("evt.e", "ext.p")).toEqual({ relation: "evt.target", from: "evt.e", to: "ext.p" });
    expect(inferLink("ext.p", "evt.e")).toEqual({ relation: "evt.source", from: "evt.e", to: "ext.p" });
  });

  it("returns null for pairs without a relation", () => {
    expect(inferLink("scr.a", "inf.b")).toBeNull();
    expect(inferLink("uc.a", "st.b")).toBeNull();
  });

  it("recognises transitions between states of one model", () => {
    expect(inferTransition("st.o:draft", "st.o:placed")).toEqual({ model: "st.o", from: "draft", to: "placed" });
    expect(inferTransition("st.o:draft", "st.p:placed")).toBeNull();
    expect(inferTransition("uc.a", "st.o:placed")).toBeNull();
  });

  it("lists the relations an element kind can start", () => {
    expect(relationsFrom("evt").map((r) => `${r.relation}>${r.targetPrefix}`)).toEqual([
      "evt.target>act",
      "evt.target>ext",
      "evt.source>act",
      "evt.source>ext",
    ]);
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/web-views.test.ts`
Expected: FAIL（`../web/src/infer.js` が見つからない）

- [ ] **Step 4: 投影と推定を実装する**

`rdra-server/web/src/views.ts`:

```ts
import type { ElementChange } from "../../src/diff.js";
import { KINDS, emptyModel, kindOfId, type AnyElement, type Model } from "../../src/model/kinds.js";
import { parseTransitionRef, relationsOf, type Relation, type RelationKind } from "../../src/model/relations.js";
import type { ViewKey } from "../../src/model/view-keys.js";

export type ChangeStatus = "added" | "modified" | "removed";

export interface DiagramNode {
  id: string;
  type: string;
  label: string;
  elementId: string;
  parent?: string;
  status?: ChangeStatus;
}

export interface DiagramEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  relation?: RelationKind;
  from?: string;
  to?: string;
  status?: "added" | "removed";
}

export interface Diagram {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
}

const VIEW_PREFIXES: Record<ViewKey, readonly string[]> = {
  "system-context": ["act", "ext"],
  "business-flow": ["buc", "act", "uc"],
  "usecase-composite": ["uc", "act", "scr", "evt", "inf", "ext", "st"],
  "information-model": ["inf"],
  "state-model": [],
};

const VIEW_RELATIONS: Record<ViewKey, readonly RelationKind[]> = {
  "system-context": [],
  "business-flow": ["buc.actor", "buc.usecase"],
  "usecase-composite": ["uc.actor", "uc.screen", "uc.event", "uc.information", "uc.transition", "evt.source", "evt.target"],
  "information-model": ["inf.related"],
  "state-model": [],
};

export const SYSTEM_NODE_ID = "system";

export function viewForId(id: string): ViewKey {
  const prefix = id.split(/[.:]/, 1)[0];
  if (prefix === "act" || prefix === "ext") return "system-context";
  if (prefix === "buc") return "business-flow";
  if (prefix === "inf") return "information-model";
  if (prefix === "st") return "state-model";
  return "usecase-composite";
}

export function stateNodeId(modelId: string, stateId: string): string {
  return `${modelId}:${stateId}`;
}

function single(element: AnyElement): Model {
  const model = emptyModel();
  const kind = kindOfId(element.id);
  if (kind) (model[kind.key] as AnyElement[]).push(element);
  return model;
}

const relationKey = (r: Relation) => `${r.kind}|${r.from}|${r.to}`;

function edgeFor(r: Relation, status?: "added" | "removed"): DiagramEdge {
  const base = { id: relationKey(r), source: r.from, target: r.to, relation: r.kind, from: r.from, to: r.to, status };
  if (r.kind === "uc.transition") {
    const t = parseTransitionRef(r.to);
    return { ...base, target: t ? t.model : r.to, label: t ? `${t.from}→${t.to}` : r.to };
  }
  if (r.kind === "uc.information") return { ...base, label: r.attrs.access };
  if (r.kind === "inf.related") return { ...base, label: r.attrs.label };
  return base;
}

function projectElements(view: ViewKey, model: Model, changes: ElementChange[]): Diagram {
  const prefixes = VIEW_PREFIXES[view];
  const statusOf = new Map(changes.map((c) => [c.id, c.type]));
  const nodes: DiagramNode[] = [];
  for (const kind of KINDS) {
    if (!prefixes.includes(kind.prefix)) continue;
    for (const e of model[kind.key] as AnyElement[]) {
      nodes.push({ id: e.id, type: kind.prefix, label: e.name, elementId: e.id, status: statusOf.get(e.id) });
    }
  }
  for (const c of changes) {
    if (c.type === "removed" && c.before && prefixes.includes(c.id.split(".")[0])) {
      nodes.push({ id: c.id, type: c.id.split(".")[0], label: c.before.name, elementId: c.id, status: "removed" });
    }
  }

  const allowed = new Set(VIEW_RELATIONS[view]);
  const current = relationsOf(model).filter((r) => allowed.has(r.kind));
  const currentKeys = new Set(current.map(relationKey));
  const addedKeys = new Set<string>();
  const removed: Relation[] = [];
  for (const c of changes) {
    const before = c.before ? relationsOf(single(c.before)).filter((r) => allowed.has(r.kind)) : [];
    const after = c.after ? relationsOf(single(c.after)).filter((r) => allowed.has(r.kind)) : [];
    const beforeKeys = new Set(before.map(relationKey));
    for (const r of after) if (!beforeKeys.has(relationKey(r))) addedKeys.add(relationKey(r));
    for (const r of before) if (!currentKeys.has(relationKey(r))) removed.push(r);
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const edges = [
    ...current.map((r) => edgeFor(r, addedKeys.has(relationKey(r)) ? "added" : undefined)),
    ...removed.map((r) => edgeFor(r, "removed")),
  ].filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  if (view === "system-context") {
    nodes.push({ id: SYSTEM_NODE_ID, type: "system", label: "システム", elementId: SYSTEM_NODE_ID });
    for (const n of nodes) {
      if (n.type === "act" || n.type === "ext") {
        const events = model.events.filter((e) => e.source === n.id || e.target === n.id).map((e) => e.name);
        edges.push({ id: `ctx|${n.id}`, source: n.id, target: SYSTEM_NODE_ID, label: events.join("、") || undefined });
      }
    }
  }
  return { nodes, edges };
}

function projectStates(model: Model, changes: ElementChange[]): Diagram {
  const statusOf = new Map(changes.map((c) => [c.id, c.type]));
  const nodes: DiagramNode[] = [];
  const edges: DiagramEdge[] = [];
  for (const sm of model.states) {
    nodes.push({ id: sm.id, type: "st", label: sm.name, elementId: sm.id, status: statusOf.get(sm.id) });
    for (const s of sm.states) {
      nodes.push({ id: stateNodeId(sm.id, s.id), type: "state", label: s.name, elementId: sm.id, parent: sm.id });
    }
    for (const t of sm.transitions) {
      const ref = `${sm.id}:${t.from}->${t.to}`;
      const causes = model.usecases.filter((u) => u.transitions.includes(ref)).map((u) => u.name);
      edges.push({
        id: `tr|${ref}`,
        source: stateNodeId(sm.id, t.from),
        target: stateNodeId(sm.id, t.to),
        label: causes.join("、") || undefined,
        from: sm.id,
        to: ref,
      });
    }
  }
  return { nodes, edges };
}

export function projectView(view: ViewKey, model: Model, changes: ElementChange[] = []): Diagram {
  return view === "state-model" ? projectStates(model, changes) : projectElements(view, model, changes);
}
```

`rdra-server/web/src/infer.ts`:

```ts
import type { RelationKind } from "../../src/model/relations.js";

export interface LinkIntent {
  relation: RelationKind;
  from: string;
  to: string;
  attrs?: Record<string, string>;
}

export interface TransitionIntent {
  model: string;
  from: string;
  to: string;
}

const PAIRS: readonly [string, string, RelationKind][] = [
  ["buc", "act", "buc.actor"],
  ["buc", "uc", "buc.usecase"],
  ["uc", "act", "uc.actor"],
  ["uc", "scr", "uc.screen"],
  ["uc", "evt", "uc.event"],
  ["uc", "inf", "uc.information"],
  ["uc", "st", "uc.transition"],
  ["evt", "act", "evt.target"],
  ["evt", "ext", "evt.target"],
  ["inf", "inf", "inf.related"],
  ["st", "inf", "st.information"],
];

const prefixOf = (id: string) => id.split(/[.:]/, 1)[0];

function withDefaults(intent: LinkIntent): LinkIntent {
  return intent.relation === "uc.information" ? { ...intent, attrs: { access: "read" } } : intent;
}

export function inferLink(a: string, b: string): LinkIntent | null {
  const pa = prefixOf(a);
  const pb = prefixOf(b);
  for (const [source, target, relation] of PAIRS) {
    if (relation === "uc.transition") continue;
    if (pa === source && pb === target) return withDefaults({ relation, from: a, to: b });
    if (pa === target && pb === source) {
      if (relation === "evt.target") return { relation: "evt.source", from: b, to: a };
      return withDefaults({ relation, from: b, to: a });
    }
  }
  return null;
}

export function inferTransition(a: string, b: string): TransitionIntent | null {
  const pa = a.split(":");
  const pb = b.split(":");
  if (pa.length !== 2 || pb.length !== 2 || pa[0] !== pb[0] || !pa[0].startsWith("st.") || pa[1] === pb[1]) return null;
  return { model: pa[0], from: pa[1], to: pb[1] };
}

export function relationsFrom(prefix: string): { relation: RelationKind; targetPrefix: string }[] {
  const out: { relation: RelationKind; targetPrefix: string }[] = [];
  for (const [source, target, relation] of PAIRS) if (source === prefix) out.push({ relation, targetPrefix: target });
  if (prefix === "evt") {
    out.push({ relation: "evt.source", targetPrefix: "act" }, { relation: "evt.source", targetPrefix: "ext" });
  }
  return out;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run && npx tsc -p .`
Expected: すべて PASS（web-views 11 件を含む）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/package.json rdra-server/package-lock.json rdra-server/vite.config.ts rdra-server/vitest.config.ts rdra-server/web/tsconfig.json rdra-server/web/src/views.ts rdra-server/web/src/infer.ts rdra-server/test/web-views.test.ts
git commit -m "Add diagram projection and relation inference for the review UI"
```

---

### Task 6: React の画面

**Files:**
- Create: `rdra-server/web/index.html`
- Create: `rdra-server/web/src/main.tsx`、`app.tsx`、`api.ts`、`auto-layout.ts`、`styles.css`
- Create: `rdra-server/web/src/components/diagram-canvas.tsx`、`palette.tsx`、`inspector.tsx`、`review-panel.tsx`
- Modify: `rdra-server/build.mjs`

**Interfaces:**
- Consumes: HTTP API（Task 3）、`projectView`, `viewForId`, `inferLink`, `inferTransition`, `relationsFrom`（Task 5）、`applyOperations`（削除時に外れる関連のプレビュー）
- Produces:
  - `dist/web/`（`index.html` と `assets/`）。`server.js` と `cli.js serve` がこれを配信する
  - E2E（Task 7）が使うアクセシブルな名前: 種類 / ID / 名前 / 追加（パレット）、関連の種類 / 関連先 / アクセス / 関連を追加 / この要素にコメント / 保存 / 削除… / 削除する（インスペクター）、コメント / コメントを追加 / 承認 / 差し戻す（レビューパネル）、状態表示の「レビュー待ち」「差し戻し済み」「承認済み」

画面の構成:
- ヘッダー: 5 つのビューの切り替えと「この feature の差分」チェック（分岐点がなければ無効）
- 左: パレット（種類・ID・名前で要素を追加）と図。ノードをドラッグすると座標を保存し、ノード同士を線で結ぶと `inferLink` / `inferTransition` で関連を張る
- 右上: インスペクター（名前・説明・業務・属性の編集、関連の一覧と外す、関連の追加、ユースケースが起こす遷移の選択、状態と遷移の編集、削除の確認と外れる関連の表示、この要素にコメント）
- 右下: レビューパネル（状態、検証結果とジャンプ、コメントの下書き、承認・差し戻し、前回の判断）
- YAML の構文エラー中は上部に赤いバナーを出し、編集系の操作を無効にする
- 409 を受けたら「他の変更があったため、この編集は取り消されました。最新の状態を読み込みました。」と表示して読み直す

- [ ] **Step 1: 画面のファイルを作る**

`rdra-server/web/index.html`:

```html
<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RDRA レビュー</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.tsx"></script>
  </body>
</html>
```

`rdra-server/web/src/main.tsx`:

```tsx
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@xyflow/react/dist/style.css";
import { App } from "./app.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

`rdra-server/web/src/api.ts`:

```ts
import type { ElementChange } from "../../src/diff.js";
import type { Model } from "../../src/model/kinds.js";
import type { Layout, Positions, ViewKey } from "../../src/model/view-keys.js";
import type { Operation } from "../../src/operations.js";
import type { ReviewComment, ReviewRecord } from "../../src/review.js";
import type { ApplyResult } from "../../src/store.js";
import type { Issue } from "../../src/validate.js";

export interface AppState {
  version: string;
  parseError: string | null;
  model: Model;
  issues: Issue[];
  layout: Layout;
  featureDir: string | null;
  review: ReviewRecord | null;
  approval: "none" | "pending" | "rejected" | "approved" | "stale";
}

export interface DiffState {
  base: string | null;
  changes: ElementChange[];
  note?: string;
}

export interface Response<T> {
  status: number;
  data: T;
}

async function send<T>(method: string, path: string, body: unknown): Promise<Response<T>> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-rdra-client": "web" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  state: () => get<AppState>("api/state"),
  diff: () => get<DiffState>("api/diff"),
  apply: (expectedVersion: string, ops: Operation[]) => send<ApplyResult>("POST", "api/ops", { expectedVersion, ops }),
  saveLayout: (view: ViewKey, positions: Positions) => send<null>("PUT", `api/layout/${view}`, { positions }),
  decide: (decision: "approved" | "rejected", comments: ReviewComment[], version: string) =>
    send<{ review?: ReviewRecord; message?: string }>("POST", "api/review/decision", { decision, comments, version }),
};

export function subscribe(onMessage: (message: { type: string }) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  const connect = () => {
    const url = new URL("ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onmessage = (event) => onMessage(JSON.parse(String(event.data)) as { type: string });
    socket.onclose = () => {
      if (!closed) setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    closed = true;
    socket?.close();
  };
}
```

`rdra-server/web/src/auto-layout.ts`:

```ts
import ELK, { type ElkNode } from "elkjs/lib/elk.bundled.js";
import type { Positions } from "../../src/model/view-keys.js";
import type { Diagram } from "./views.js";

export const NODE_WIDTH = 170;
export const NODE_HEIGHT = 44;

export interface LayoutResult {
  positions: Positions;
  sizes: Record<string, { width: number; height: number }>;
}

const elk = new ELK();

export async function autoLayout(diagram: Diagram, stored: Positions): Promise<LayoutResult> {
  const childrenOf = new Map<string, ElkNode[]>();
  const roots: ElkNode[] = [];
  const parents = new Set(diagram.nodes.filter((n) => n.parent).map((n) => n.parent!));
  for (const n of diagram.nodes) {
    const node: ElkNode = { id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT };
    if (parents.has(n.id)) {
      node.children = [];
      childrenOf.set(n.id, node.children);
      node.layoutOptions = { "elk.padding": "[top=40,left=20,bottom=20,right=20]" };
    }
    if (n.parent) continue;
    roots.push(node);
  }
  for (const n of diagram.nodes) {
    if (n.parent) childrenOf.get(n.parent)?.push({ id: n.id, width: NODE_WIDTH, height: NODE_HEIGHT });
  }
  const graph = await elk.layout({
    id: "root",
    layoutOptions: {
      "elk.algorithm": "layered",
      "elk.direction": "RIGHT",
      "elk.hierarchyHandling": "INCLUDE_CHILDREN",
      "elk.spacing.nodeNode": "40",
      "elk.layered.spacing.nodeNodeBetweenLayers": "90",
    },
    children: roots,
    edges: diagram.edges.map((e) => ({ id: e.id, sources: [e.source], targets: [e.target] })),
  });

  const positions: Positions = {};
  const sizes: LayoutResult["sizes"] = {};
  const visit = (nodes: ElkNode[] | undefined) => {
    for (const n of nodes ?? []) {
      positions[n.id] = { x: Math.round(n.x ?? 0), y: Math.round(n.y ?? 0) };
      if (n.children && n.children.length > 0) sizes[n.id] = { width: n.width ?? NODE_WIDTH, height: n.height ?? NODE_HEIGHT };
      visit(n.children);
    }
  };
  visit(graph.children);
  return { positions: { ...positions, ...stored }, sizes };
}
```

`rdra-server/web/src/components/diagram-canvas.tsx`:

```tsx
import {
  Background,
  ConnectionMode,
  Controls,
  MarkerType,
  Position,
  ReactFlow,
  applyNodeChanges,
  type Edge,
  type Node,
  type NodeChange,
} from "@xyflow/react";
import { useEffect, useMemo, useState } from "react";
import type { Positions } from "../../../src/model/view-keys.js";
import type { LayoutResult } from "../auto-layout.js";
import type { Diagram } from "../views.js";

export type Selection = { type: "node" | "edge"; id: string } | null;

interface Props {
  diagram: Diagram;
  layout: LayoutResult;
  selection: Selection;
  readOnly: boolean;
  onSelect: (selection: Selection) => void;
  onConnect: (source: string, target: string) => void;
  onMoved: (positions: Positions) => void;
}

export function DiagramCanvas({ diagram, layout, selection, readOnly, onSelect, onConnect, onMoved }: Props) {
  const initialNodes = useMemo<Node[]>(
    () =>
      diagram.nodes.map((n) => ({
        id: n.id,
        position: layout.positions[n.id] ?? { x: 0, y: 0 },
        data: { label: n.label },
        sourcePosition: Position.Right,
        targetPosition: Position.Left,
        parentId: n.parent,
        extent: n.parent ? ("parent" as const) : undefined,
        className: ["rdra-node", `rdra-${n.type}`, n.status ? `rdra-${n.status}` : "", layout.sizes[n.id] ? "rdra-group" : ""].join(" "),
        style: layout.sizes[n.id],
        draggable: !readOnly && n.status !== "removed",
        connectable: !readOnly && n.status !== "removed",
        selected: selection?.type === "node" && selection.id === n.id,
      })),
    [diagram, layout, readOnly, selection],
  );
  const [nodes, setNodes] = useState<Node[]>(initialNodes);
  useEffect(() => setNodes(initialNodes), [initialNodes]);

  const edges = useMemo<Edge[]>(
    () =>
      diagram.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        label: e.label,
        className: e.status ? `rdra-edge-${e.status}` : undefined,
        markerEnd: { type: MarkerType.ArrowClosed },
        selectable: Boolean(e.relation || e.id.startsWith("tr|")),
        selected: selection?.type === "edge" && selection.id === e.id,
      })),
    [diagram, selection],
  );

  return (
    <ReactFlow
      nodes={nodes}
      edges={edges}
      connectionMode={ConnectionMode.Loose}
      nodesConnectable={!readOnly}
      onNodesChange={(changes: NodeChange[]) => setNodes((current) => applyNodeChanges(changes, current))}
      onNodeDragStop={(_event, _node, dragged) =>
        onMoved(Object.fromEntries(dragged.map((n) => [n.id, { x: n.position.x, y: n.position.y }])))
      }
      onConnect={(c) => c.source && c.target && c.source !== c.target && onConnect(c.source, c.target)}
      onNodeClick={(_event, node) => onSelect({ type: "node", id: node.id })}
      onEdgeClick={(_event, edge) => onSelect({ type: "edge", id: edge.id })}
      onPaneClick={() => onSelect(null)}
      fitView
      fitViewOptions={{ maxZoom: 1 }}
    >
      <Background />
      <Controls />
    </ReactFlow>
  );
}
```

`rdra-server/web/src/components/palette.tsx`:

```tsx
import { useState } from "react";
import { KINDS, SLUG, type KindKey } from "../../../src/model/kinds.js";
import type { Operation } from "../../../src/operations.js";

interface Props {
  disabled: boolean;
  onApply: (ops: Operation[]) => Promise<boolean>;
}

const slugPattern = new RegExp(`^${SLUG}$`);

export function Palette({ disabled, onApply }: Props) {
  const [kind, setKind] = useState<KindKey>("usecases");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const prefix = KINDS.find((k) => k.key === kind)!.prefix;
  const valid = slugPattern.test(slug) && name.trim() !== "";

  const add = async () => {
    if (await onApply([{ op: "upsert", kind, element: { id: `${prefix}.${slug}`, name: name.trim() } }])) {
      setSlug("");
      setName("");
    }
  };

  return (
    <form
      className="palette"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void add();
      }}
    >
      <label>
        種類
        <select aria-label="種類" value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value as KindKey)}>
          {KINDS.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        ID
        <span className="id-input">
          {prefix}.
          <input aria-label="ID" value={slug} disabled={disabled} placeholder="place-order" onChange={(e) => setSlug(e.target.value)} />
        </span>
      </label>
      <label>
        名前
        <input aria-label="名前" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" disabled={disabled || !valid}>
        追加
      </button>
    </form>
  );
}
```

`rdra-server/web/src/components/inspector.tsx`:

```tsx
import { useState } from "react";
import {
  AccessSchema,
  SLUG,
  emptyModel,
  findElement,
  kindOfId,
  type AnyElement,
  type Model,
  type StateModel,
} from "../../../src/model/kinds.js";
import { parseTransitionRef, relationsOf, type Relation, type RelationKind } from "../../../src/model/relations.js";
import { applyOperations, type Operation } from "../../../src/operations.js";
import { relationsFrom } from "../infer.js";
import type { Diagram } from "../views.js";
import type { Selection } from "./diagram-canvas.js";

interface Props {
  model: Model;
  diagram: Diagram;
  selection: Selection;
  disabled: boolean;
  onApply: (ops: Operation[]) => Promise<boolean>;
  onComment: (target: string) => void;
  onSelect: (selection: Selection) => void;
}

const slugPattern = new RegExp(`^${SLUG}$`);
const ACCESS = AccessSchema.options;

function outgoing(element: AnyElement): Relation[] {
  const m = emptyModel();
  const kind = kindOfId(element.id)!;
  (m[kind.key] as AnyElement[]).push(element);
  return relationsOf(m);
}

function allElements(model: Model): AnyElement[] {
  return Object.values(model).flat() as AnyElement[];
}

function transitionRefs(model: Model): { ref: string; label: string }[] {
  return model.states.flatMap((sm) =>
    sm.transitions.map((t) => ({ ref: `${sm.id}:${t.from}->${t.to}`, label: `${sm.name}: ${t.from} → ${t.to}` })),
  );
}

export function Inspector(props: Props) {
  const { diagram, selection, model } = props;
  if (!selection) return <p className="hint">図の要素か関連を選ぶと、ここで編集できます。</p>;
  if (selection.type === "edge") {
    const edge = diagram.edges.find((e) => e.id === selection.id);
    return edge ? <EdgeInspector {...props} edgeId={edge.id} /> : null;
  }
  const node = diagram.nodes.find((n) => n.id === selection.id);
  if (!node || node.type === "system") return <p className="hint">システムは編集対象ではありません。</p>;
  const found = findElement(model, node.elementId);
  if (!found) return <p className="hint">{node.label}（削除済み）</p>;
  return <ElementInspector key={found.element.id + JSON.stringify(found.element)} {...props} element={found.element} />;
}

function EdgeInspector({ diagram, model, disabled, onApply, onSelect, edgeId }: Props & { edgeId: string }) {
  const edge = diagram.edges.find((e) => e.id === edgeId)!;
  if (edge.id.startsWith("tr|") && edge.from && edge.to) {
    const sm = model.states.find((s) => s.id === edge.from);
    const t = parseTransitionRef(edge.to);
    if (!sm || !t) return null;
    const remove = () =>
      onApply([
        { op: "upsert", kind: "states", element: { id: sm.id, transitions: sm.transitions.filter((x) => !(x.from === t.from && x.to === t.to)) } },
      ]).then((ok) => ok && onSelect(null));
    return (
      <section className="inspector">
        <h3>遷移 {t.from} → {t.to}</h3>
        <button disabled={disabled} onClick={() => void remove()}>
          遷移を削除
        </button>
      </section>
    );
  }
  if (!edge.relation || !edge.from || !edge.to || edge.status === "removed") {
    return <p className="hint">この線は他の関連から導出されているため、直接は編集できません。</p>;
  }
  const { relation, from, to } = edge;
  return (
    <section className="inspector">
      <h3>{relation}</h3>
      <p>
        {from} → {to}
      </p>
      <button disabled={disabled} onClick={() => void onApply([{ op: "unlink", relation, from, to }]).then((ok) => ok && onSelect(null))}>
        関連を外す
      </button>
    </section>
  );
}

function ElementInspector({ model, disabled, onApply, onComment, onSelect, element }: Props & { element: AnyElement }) {
  const kind = kindOfId(element.id)!;
  const fields = element as unknown as Record<string, unknown>;
  const [name, setName] = useState(element.name);
  const [description, setDescription] = useState(element.description ?? "");
  const [business, setBusiness] = useState(String(fields.business ?? ""));
  const [attributes, setAttributes] = useState(((fields.attributes as string[] | undefined) ?? []).join(", "));
  const [confirmDelete, setConfirmDelete] = useState(false);

  const save = () => {
    const patch: Record<string, unknown> = { id: element.id, name: name.trim(), description: description.trim() || null };
    if (kind.key === "bucs") patch.business = business.trim() || null;
    if (kind.key === "information") {
      patch.attributes = attributes
        .split(/[,、]/)
        .map((a) => a.trim())
        .filter(Boolean);
    }
    void onApply([{ op: "upsert", kind: kind.key, element: patch }]);
  };

  const cascade = confirmDelete ? applyOperations(model, [{ op: "delete", id: element.id }]).removedRelations : [];

  return (
    <section className="inspector">
      <h3>
        {kind.label} <code>{element.id}</code>
      </h3>
      <label>
        名前
        <input aria-label="要素の名前" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      </label>
      <label>
        説明
        <textarea aria-label="説明" value={description} disabled={disabled} onChange={(e) => setDescription(e.target.value)} />
      </label>
      {kind.key === "bucs" && (
        <label>
          業務
          <input aria-label="業務" value={business} disabled={disabled} onChange={(e) => setBusiness(e.target.value)} />
        </label>
      )}
      {kind.key === "information" && (
        <label>
          属性（カンマ区切り）
          <input aria-label="属性" value={attributes} disabled={disabled} onChange={(e) => setAttributes(e.target.value)} />
        </label>
      )}
      <div className="row">
        <button disabled={disabled || name.trim() === ""} onClick={save}>
          保存
        </button>
        <button onClick={() => onComment(element.id)}>この要素にコメント</button>
      </div>

      <RelationList element={element} disabled={disabled} onApply={onApply} />
      <AddRelation model={model} element={element} disabled={disabled} onApply={onApply} />
      {kind.key === "usecases" && <TransitionPicker model={model} element={element} disabled={disabled} onApply={onApply} />}
      {kind.key === "states" && <StateEditor stateModel={element as StateModel} disabled={disabled} onApply={onApply} />}

      <div className="danger">
        {!confirmDelete ? (
          <button disabled={disabled} onClick={() => setConfirmDelete(true)}>
            削除…
          </button>
        ) : (
          <>
            <p>{element.id} を削除します。次の関連も外れます:</p>
            <ul>
              {cascade.map((r) => (
                <li key={`${r.kind}|${r.from}|${r.to}`}>
                  {r.from} → {r.to}（{r.kind}）
                </li>
              ))}
              {cascade.length === 0 && <li>なし</li>}
            </ul>
            <div className="row">
              <button onClick={() => void onApply([{ op: "delete", id: element.id }]).then((ok) => ok && onSelect(null))}>削除する</button>
              <button onClick={() => setConfirmDelete(false)}>やめる</button>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function RelationList({ element, disabled, onApply }: { element: AnyElement; disabled: boolean; onApply: Props["onApply"] }) {
  const relations = outgoing(element).filter((r) => r.kind !== "uc.transition");
  if (relations.length === 0) return null;
  return (
    <div>
      <h4>関連</h4>
      <ul className="relations">
        {relations.map((r) => (
          <li key={`${r.kind}|${r.to}`}>
            <span>
              {r.kind} → {r.to}
            </span>
            {r.kind === "uc.information" && (
              <select
                aria-label={`${r.to} のアクセス`}
                value={r.attrs.access}
                disabled={disabled}
                onChange={(e) => void onApply([{ op: "link", relation: r.kind, from: r.from, to: r.to, attrs: { access: e.target.value } }])}
              >
                {ACCESS.map((a) => (
                  <option key={a}>{a}</option>
                ))}
              </select>
            )}
            <button disabled={disabled} onClick={() => void onApply([{ op: "unlink", relation: r.kind, from: r.from, to: r.to }])}>
              外す
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddRelation({ model, element, disabled, onApply }: { model: Model; element: AnyElement; disabled: boolean; onApply: Props["onApply"] }) {
  const options = relationsFrom(kindOfId(element.id)!.prefix).filter((o) => o.relation !== "uc.transition");
  const [choice, setChoice] = useState(0);
  const [target, setTarget] = useState("");
  const [access, setAccess] = useState("read");
  if (options.length === 0) return null;
  const option = options[Math.min(choice, options.length - 1)];
  const targets = allElements(model).filter((e) => e.id.startsWith(`${option.targetPrefix}.`) && e.id !== element.id);
  const relation: RelationKind = option.relation;

  const add = () =>
    void onApply([{ op: "link", relation, from: element.id, to: target, attrs: relation === "uc.information" ? { access } : undefined }]).then(
      (ok) => ok && setTarget(""),
    );

  return (
    <div className="add-relation">
      <h4>関連を追加</h4>
      <select
        aria-label="関連の種類"
        value={choice}
        disabled={disabled}
        onChange={(e) => {
          setChoice(Number(e.target.value));
          setTarget("");
        }}
      >
        {options.map((o, i) => (
          <option key={`${o.relation}>${o.targetPrefix}`} value={i}>
            {o.relation}（→ {o.targetPrefix}）
          </option>
        ))}
      </select>
      <select aria-label="関連先" value={target} disabled={disabled} onChange={(e) => setTarget(e.target.value)}>
        <option value="">選択…</option>
        {targets.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}（{t.id}）
          </option>
        ))}
      </select>
      {relation === "uc.information" && (
        <select aria-label="アクセス" value={access} disabled={disabled} onChange={(e) => setAccess(e.target.value)}>
          {ACCESS.map((a) => (
            <option key={a}>{a}</option>
          ))}
        </select>
      )}
      <button disabled={disabled || target === ""} onClick={add}>
        関連を追加
      </button>
    </div>
  );
}

function TransitionPicker({ model, element, disabled, onApply }: { model: Model; element: AnyElement; disabled: boolean; onApply: Props["onApply"] }) {
  const refs = transitionRefs(model);
  const current = new Set((element as { transitions: string[] }).transitions);
  if (refs.length === 0) return null;
  return (
    <div>
      <h4>起こす状態遷移</h4>
      {refs.map(({ ref, label }) => (
        <label key={ref} className="check">
          <input
            type="checkbox"
            checked={current.has(ref)}
            disabled={disabled}
            onChange={(e) =>
              void onApply([{ op: e.target.checked ? "link" : "unlink", relation: "uc.transition", from: element.id, to: ref } as Operation])
            }
          />
          {label}
        </label>
      ))}
    </div>
  );
}

function StateEditor({ stateModel, disabled, onApply }: { stateModel: StateModel; disabled: boolean; onApply: Props["onApply"] }) {
  const [stateId, setStateId] = useState("");
  const [stateName, setStateName] = useState("");
  const [from, setFrom] = useState(stateModel.states[0]?.id ?? "");
  const [to, setTo] = useState(stateModel.states[1]?.id ?? "");
  const upsert = (patch: Partial<StateModel>) => onApply([{ op: "upsert", kind: "states", element: { id: stateModel.id, ...patch } }]);

  return (
    <div>
      <h4>状態</h4>
      <ul className="relations">
        {stateModel.states.map((s) => (
          <li key={s.id}>
            <span>
              {s.name}（{s.id}）
            </span>
            <button disabled={disabled} onClick={() => void upsert({ states: stateModel.states.filter((x) => x.id !== s.id) })}>
              外す
            </button>
          </li>
        ))}
      </ul>
      <div className="row">
        <input aria-label="状態ID" placeholder="draft" value={stateId} disabled={disabled} onChange={(e) => setStateId(e.target.value)} />
        <input aria-label="状態名" placeholder="下書き" value={stateName} disabled={disabled} onChange={(e) => setStateName(e.target.value)} />
        <button
          disabled={disabled || !slugPattern.test(stateId) || stateName.trim() === ""}
          onClick={() => void upsert({ states: [...stateModel.states, { id: stateId, name: stateName.trim() }] })}
        >
          状態を追加
        </button>
      </div>
      <h4>遷移</h4>
      <div className="row">
        <select aria-label="遷移元" value={from} disabled={disabled} onChange={(e) => setFrom(e.target.value)}>
          {stateModel.states.map((s) => (
            <option key={s.id}>{s.id}</option>
          ))}
        </select>
        →
        <select aria-label="遷移先" value={to} disabled={disabled} onChange={(e) => setTo(e.target.value)}>
          {stateModel.states.map((s) => (
            <option key={s.id}>{s.id}</option>
          ))}
        </select>
        <button
          disabled={disabled || !from || !to || from === to || stateModel.transitions.some((t) => t.from === from && t.to === to)}
          onClick={() => void upsert({ transitions: [...stateModel.transitions, { from, to }] })}
        >
          遷移を追加
        </button>
      </div>
    </div>
  );
}
```

`rdra-server/web/src/components/review-panel.tsx`:

```tsx
import { useState } from "react";
import type { ReviewComment } from "../../../src/review.js";
import type { AppState } from "../api.js";

interface Props {
  state: AppState;
  drafts: ReviewComment[];
  commentTarget: string | null;
  busy: boolean;
  onAddDraft: (comment: ReviewComment) => void;
  onRemoveDraft: (index: number) => void;
  onClearTarget: () => void;
  onDecide: (decision: "approved" | "rejected") => void;
  onJump: (id: string) => void;
}

const STATUS_LABELS: Record<AppState["approval"], string> = {
  none: "レビューは依頼されていません",
  pending: "レビュー待ち",
  rejected: "差し戻し済み",
  approved: "承認済み",
  stale: "承認後に変更あり（再レビューが必要）",
};

export function ReviewPanel(props: Props) {
  const { state, drafts, commentTarget, busy } = props;
  const [text, setText] = useState("");
  const errors = state.issues.filter((i) => i.level === "error");
  const warnings = state.issues.filter((i) => i.level === "warning");
  const pending = state.review?.status === "pending";
  const canApprove = pending && errors.length === 0 && !state.parseError && !busy;
  const canReject = pending && drafts.length > 0 && !busy;
  const lastRound = state.review?.rounds.at(-1);

  const add = () => {
    if (text.trim() === "") return;
    props.onAddDraft({ target: commentTarget, text: text.trim() });
    setText("");
  };

  return (
    <section className="review">
      <h3>
        レビュー: <span className={`status status-${state.approval}`}>{STATUS_LABELS[state.approval]}</span>
      </h3>
      {!state.featureDir && <p className="hint">feature の外で開いているため、承認・差し戻しはできません。</p>}

      <h4>
        検証（エラー {errors.length} / 警告 {warnings.length}）
      </h4>
      <ul className="issues">
        {[...errors, ...warnings].map((issue, i) => (
          <li key={i} className={issue.level}>
            <button className="link" disabled={!issue.elementId} onClick={() => issue.elementId && props.onJump(issue.elementId)}>
              {issue.message}
            </button>
          </li>
        ))}
      </ul>

      <h4>コメント</h4>
      <ul className="drafts">
        {drafts.map((d, i) => (
          <li key={i}>
            {d.target && <code>{d.target}</code>} {d.text}
            <button onClick={() => props.onRemoveDraft(i)}>削除</button>
          </li>
        ))}
      </ul>
      <div className="comment-target">
        対象: {commentTarget ? <code>{commentTarget}</code> : "全体"}
        {commentTarget && <button onClick={props.onClearTarget}>全体にする</button>}
      </div>
      <textarea aria-label="コメント" value={text} onChange={(e) => setText(e.target.value)} />
      <button disabled={text.trim() === ""} onClick={add}>
        コメントを追加
      </button>

      <div className="row decision">
        <button className="approve" disabled={!canApprove} onClick={() => props.onDecide("approved")}>
          承認
        </button>
        <button className="reject" disabled={!canReject} onClick={() => props.onDecide("rejected")}>
          差し戻す
        </button>
      </div>

      {lastRound && (
        <div className="history">
          <h4>前回の判断: {lastRound.decision === "approved" ? "承認" : "差し戻し"}</h4>
          <ul>
            {lastRound.comments.map((c, i) => (
              <li key={i}>
                {c.target && <code>{c.target}</code>} {c.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
```

`rdra-server/web/src/app.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useState } from "react";
import { VIEW_KEYS, VIEW_LABELS, type Positions, type ViewKey } from "../../src/model/view-keys.js";
import type { Operation } from "../../src/operations.js";
import type { ReviewComment } from "../../src/review.js";
import { api, subscribe, type AppState, type DiffState } from "./api.js";
import { autoLayout, type LayoutResult } from "./auto-layout.js";
import { DiagramCanvas, type Selection } from "./components/diagram-canvas.js";
import { Inspector } from "./components/inspector.js";
import { Palette } from "./components/palette.js";
import { ReviewPanel } from "./components/review-panel.js";
import { inferLink, inferTransition } from "./infer.js";
import { projectView, viewForId } from "./views.js";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [view, setView] = useState<ViewKey>("usecase-composite");
  const [diffMode, setDiffMode] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [layout, setLayout] = useState<{ view: ViewKey; result: LayoutResult } | null>(null);
  const [drafts, setDrafts] = useState<ReviewComment[]>([]);
  const [commentTarget, setCommentTarget] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [s, d] = await Promise.all([api.state(), api.diff()]);
    setState(s);
    setDiff(d);
  }, []);

  useEffect(() => {
    void refresh();
    return subscribe(() => void refresh());
  }, [refresh]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(timer);
  }, [toast]);

  const diagram = useMemo(
    () => (state ? projectView(view, state.model, diffMode && diff ? diff.changes : []) : { nodes: [], edges: [] }),
    [state, diff, view, diffMode],
  );

  useEffect(() => {
    if (!state) return;
    let cancelled = false;
    void autoLayout(diagram, state.layout[view]).then((result) => !cancelled && setLayout({ view, result }));
    return () => {
      cancelled = true;
    };
  }, [diagram, state, view]);

  const apply = useCallback(
    async (ops: Operation[]): Promise<boolean> => {
      if (!state) return false;
      const res = await api.apply(state.version, ops);
      if (res.status === 409) {
        setToast("他の変更があったため、この編集は取り消されました。最新の状態を読み込みました。");
        await refresh();
        return false;
      }
      if (!res.data.ok) {
        setToast(res.data.message);
        return false;
      }
      await refresh();
      return true;
    },
    [state, refresh],
  );

  const connect = (source: string, target: string) => {
    if (!state) return;
    const transition = inferTransition(source, target);
    if (transition) {
      const sm = state.model.states.find((s) => s.id === transition.model);
      if (sm && !sm.transitions.some((t) => t.from === transition.from && t.to === transition.to)) {
        void apply([
          { op: "upsert", kind: "states", element: { id: sm.id, transitions: [...sm.transitions, { from: transition.from, to: transition.to }] } },
        ]);
      }
      return;
    }
    const link = inferLink(source, target);
    if (!link) {
      setToast(`${source} と ${target} の間には関連を張れません`);
      return;
    }
    void apply([{ op: "link", ...link }]);
  };

  const moved = (positions: Positions) => void api.saveLayout(view, positions);

  const decideReview = async (decision: "approved" | "rejected") => {
    if (!state) return;
    setBusy(true);
    try {
      const res = await api.decide(decision, drafts, state.version);
      if (res.status === 200) {
        setDrafts([]);
        setCommentTarget(null);
        setToast(decision === "approved" ? "承認しました" : "差し戻しました");
      } else {
        setToast(res.data.message ?? `失敗しました（${res.status}）`);
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const jump = (id: string) => {
    setView(viewForId(id));
    setSelection({ type: "node", id });
  };

  if (!state) return <div className="loading">読み込み中…</div>;
  const readOnly = state.parseError !== null;

  return (
    <div className="app">
      <header>
        <h1>RDRA レビュー</h1>
        <nav>
          {VIEW_KEYS.map((v) => (
            <button key={v} className={v === view ? "active" : ""} onClick={() => setView(v)}>
              {VIEW_LABELS[v]}
            </button>
          ))}
        </nav>
        <label className="check" title={diff?.base ? `基準: ${diff.base.slice(0, 8)}` : "比較対象の分岐点がありません"}>
          <input type="checkbox" checked={diffMode} disabled={!diff?.base} onChange={(e) => setDiffMode(e.target.checked)} />
          この feature の差分
        </label>
      </header>
      {state.parseError && (
        <div className="banner error">
          YAML にエラーがあります: {state.parseError}（修正すると編集できるようになります）
        </div>
      )}
      <main>
        <div className="canvas">
          <Palette disabled={readOnly} onApply={apply} />
          {layout?.view === view ? (
            <DiagramCanvas
              key={view}
              diagram={diagram}
              layout={layout.result}
              selection={selection}
              readOnly={readOnly}
              onSelect={setSelection}
              onConnect={connect}
              onMoved={moved}
            />
          ) : (
            <div className="loading">配置を計算中…</div>
          )}
        </div>
        <aside>
          <Inspector
            model={state.model}
            diagram={diagram}
            selection={selection}
            disabled={readOnly}
            onApply={apply}
            onComment={setCommentTarget}
            onSelect={setSelection}
          />
          <ReviewPanel
            state={state}
            drafts={drafts}
            commentTarget={commentTarget}
            busy={busy}
            onAddDraft={(c) => setDrafts((d) => [...d, c])}
            onRemoveDraft={(i) => setDrafts((d) => d.filter((_, j) => j !== i))}
            onClearTarget={() => setCommentTarget(null)}
            onDecide={(d) => void decideReview(d)}
            onJump={jump}
          />
        </aside>
      </main>
      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
```

`rdra-server/web/src/styles.css`:

```css
:root {
  font-family: system-ui, -apple-system, "Hiragino Sans", sans-serif;
  font-size: 14px;
  color: #1f2328;
  background: #f6f8fa;
}
body {
  margin: 0;
}
button {
  font: inherit;
  padding: 4px 10px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
  background: #fff;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
input,
select,
textarea {
  font: inherit;
  padding: 4px 6px;
  border: 1px solid #d0d7de;
  border-radius: 6px;
}
textarea {
  width: 100%;
  min-height: 60px;
  box-sizing: border-box;
}
code {
  font-size: 12px;
  background: #eff1f3;
  padding: 1px 4px;
  border-radius: 4px;
}
.app {
  display: flex;
  flex-direction: column;
  height: 100vh;
}
header {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #d0d7de;
}
header h1 {
  font-size: 16px;
  margin: 0;
}
nav {
  display: flex;
  gap: 4px;
}
nav button.active {
  background: #0969da;
  color: #fff;
  border-color: #0969da;
}
main {
  flex: 1;
  display: grid;
  grid-template-columns: 1fr 380px;
  min-height: 0;
}
.canvas {
  display: grid;
  grid-template-rows: auto 1fr;
  min-height: 0;
}
aside {
  overflow-y: auto;
  background: #fff;
  border-left: 1px solid #d0d7de;
  padding: 12px;
  display: flex;
  flex-direction: column;
  gap: 16px;
}
.palette {
  display: flex;
  gap: 12px;
  align-items: end;
  padding: 8px 16px;
  background: #fff;
  border-bottom: 1px solid #d0d7de;
}
.palette label,
.inspector label {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 12px;
  color: #57606a;
}
.id-input {
  display: flex;
  align-items: center;
  gap: 2px;
  color: #1f2328;
}
.inspector {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.inspector h3,
.review h3 {
  margin: 0;
  font-size: 15px;
}
h4 {
  margin: 8px 0 4px;
  font-size: 13px;
}
.row {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.check {
  display: flex;
  flex-direction: row;
  align-items: center;
  gap: 6px;
}
.relations,
.issues,
.drafts {
  list-style: none;
  padding: 0;
  margin: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.relations li,
.drafts li {
  display: flex;
  gap: 6px;
  align-items: center;
  justify-content: space-between;
}
.issues .error button {
  color: #cf222e;
}
.issues .warning button {
  color: #9a6700;
}
button.link {
  border: none;
  background: none;
  padding: 0;
  text-align: left;
}
.danger {
  border-top: 1px solid #d0d7de;
  padding-top: 8px;
}
.hint {
  color: #57606a;
}
.status-approved {
  color: #1a7f37;
}
.status-rejected,
.status-stale {
  color: #cf222e;
}
.status-pending {
  color: #9a6700;
}
.decision button.approve:not(:disabled) {
  background: #1a7f37;
  color: #fff;
  border-color: #1a7f37;
}
.decision button.reject:not(:disabled) {
  background: #cf222e;
  color: #fff;
  border-color: #cf222e;
}
.banner.error {
  padding: 8px 16px;
  background: #ffebe9;
  color: #cf222e;
  border-bottom: 1px solid #ff8182;
}
.toast {
  position: fixed;
  bottom: 16px;
  left: 50%;
  transform: translateX(-50%);
  background: #1f2328;
  color: #fff;
  padding: 8px 16px;
  border-radius: 6px;
}
.loading {
  padding: 32px;
}
.rdra-node {
  border-radius: 8px;
  font-size: 13px;
}
.rdra-act {
  background: #fff8c5;
}
.rdra-ext {
  background: #eaeef2;
}
.rdra-system {
  background: #ddf4ff;
  font-weight: bold;
}
.rdra-buc {
  background: #fbefff;
}
.rdra-uc {
  background: #ffffff;
  border-radius: 999px;
}
.rdra-scr {
  background: #dafbe1;
}
.rdra-evt {
  background: #fff1e5;
}
.rdra-inf {
  background: #ddf4ff;
}
.rdra-st.rdra-group {
  background: rgba(221, 244, 255, 0.4);
  text-align: left;
  font-weight: bold;
}
.rdra-state {
  border-radius: 999px;
}
.rdra-added {
  outline: 3px solid #2da44e;
}
.rdra-modified {
  outline: 3px solid #d4a72c;
}
.rdra-removed {
  outline: 3px dashed #cf222e;
  opacity: 0.6;
}
.rdra-edge-added path {
  stroke: #2da44e !important;
  stroke-width: 2;
}
.rdra-edge-removed path {
  stroke: #cf222e !important;
  stroke-dasharray: 6 4;
}
```

- [ ] **Step 2: ビルドに Web を加える**

`rdra-server/build.mjs` を次に置き換える:

`rdra-server/build.mjs`:

```js
import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

await esbuild({
  entryPoints: { server: "src/bin/server.ts", cli: "src/bin/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});

await viteBuild({ configFile: "vite.config.ts", logLevel: "warn" });
```

- [ ] **Step 3: 型検査とビルドを確認する**

Run: `cd rdra-server && npm run typecheck && npm run build`
Expected: エラーなし。`dist/web/index.html` と `dist/web/assets/*.js` / `*.css` ができる

- [ ] **Step 4: 手で動かして見た目を確認する**

Run:

```bash
cd rdra-server
node dist/cli.js serve --repo /path/to/a/repo/with/docs/rdra
```

出力された URL をブラウザで開き、次を確認する:
- 5 つのビューが切り替わり、ノードが左から右へ重ならずに並ぶ（初回表示で極端に拡大されない）
- 図がヘッダーより下の全体に広がる（上部に潰れない）
- ノードのドラッグ後にリロードしても位置が保たれる

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/web rdra-server/build.mjs
git commit -m "Add React review UI with diagram editing and review panel"
```

---

### Task 7: E2E テストとビルド成果物

**Files:**
- Create: `rdra-server/playwright.config.ts`
- Create: `rdra-server/e2e/review.spec.ts`
- Modify: `rdra-server/test/dist.test.ts`
- Modify: `.gitignore`
- Modify: `rdra-server/dist/`（ビルド成果物を更新してコミット）

**Interfaces:**
- Consumes: `cli.js serve` / `hash` / `check-approval`（Task 4、計画 1 Task 12）、画面のアクセシブルな名前（Task 6）
- Produces: 「GUI で要素と関連を追加 → 要素にコメントして差し戻し → 再依頼 → 承認 → `check-approval` が 0 を返す」までを通す E2E テスト

- [ ] **Step 1: ブラウザを用意する**

Run: `cd rdra-server && npx playwright install chromium`

- [ ] **Step 2: E2E テストを書く**

`rdra-server/playwright.config.ts`:

```ts
import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "e2e",
  timeout: 60_000,
  use: { headless: true },
});
```

`rdra-server/e2e/review.spec.ts`:

```ts
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import { RDRA_DIR } from "../src/model/io.js";
import { REVIEW_FILE, emptyReview, requestReview, type ReviewRecord } from "../src/review.js";
import { sampleFiles } from "../test/fixtures.js";
import { makeRepo } from "../test/helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(root, "dist", "cli.js");
const FEATURE = "specs/001-demo";

let repo: string;
let server: ChildProcess;
let url: string;

const reviewPath = () => join(repo, FEATURE, REVIEW_FILE);
const readRecord = async () => JSON.parse(await readFile(reviewPath(), "utf8")) as ReviewRecord;
const requestAgain = async (record: ReviewRecord) =>
  writeFile(reviewPath(), JSON.stringify(requestReview(record, { now: new Date().toISOString(), baseCommit: null }), null, 2));

test.beforeAll(async () => {
  const files = Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
  repo = await makeRepo({ ...files, ".geass/feature.json": JSON.stringify({ feature_directory: FEATURE }) });
  await mkdir(join(repo, FEATURE), { recursive: true });
  await requestAgain(emptyReview());
  server = spawn("node", [cli, "serve", "--repo", repo], { stdio: ["ignore", "pipe", "ignore"] });
  url = await new Promise<string>((resolve, reject) => {
    server.stdout!.once("data", (chunk) => resolve(JSON.parse(String(chunk)).url));
    server.once("exit", (code) => reject(new Error(`serve exited with ${code}`)));
  });
});

test.afterAll(() => {
  server?.kill("SIGTERM");
});

test("edit the model, reject with a comment, then approve", async ({ page }) => {
  await page.goto(url);
  await expect(page.getByText("注文する", { exact: true })).toBeVisible();
  if (process.env.RDRA_SCREENSHOT) await page.screenshot({ path: process.env.RDRA_SCREENSHOT, fullPage: true });
  await expect(page.getByText("レビュー待ち")).toBeVisible();

  await page.getByLabel("種類").selectOption("screens");
  await page.getByLabel("ID", { exact: true }).fill("confirm");
  await page.getByLabel("名前", { exact: true }).fill("確認画面");
  await page.getByRole("button", { name: "追加", exact: true }).click();
  await expect(page.locator(".react-flow__node", { hasText: "確認画面" })).toBeVisible();
  expect(await readFile(join(repo, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.confirm");

  await page.locator(".react-flow__node", { hasText: "注文する" }).click();
  await page.getByLabel("関連の種類").selectOption({ label: "uc.screen（→ scr）" });
  await page.getByLabel("関連先").selectOption("scr.confirm");
  await page.getByRole("button", { name: "関連を追加" }).click();
  await expect.poll(async () => readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toContain("scr.confirm");

  await page.getByRole("button", { name: "この要素にコメント" }).click();
  await page.getByLabel("コメント").fill("在庫の扱いを書いてください");
  await page.getByRole("button", { name: "コメントを追加" }).click();
  await page.getByRole("button", { name: "差し戻す" }).click();
  await expect(page.getByText("差し戻し済み")).toBeVisible();
  const rejected = await readRecord();
  expect(rejected.status).toBe("rejected");
  expect(rejected.rounds[0].comments).toEqual([{ target: "uc.place-order", text: "在庫の扱いを書いてください" }]);

  await requestAgain(rejected);
  await page.reload();
  await expect(page.getByText("レビュー待ち")).toBeVisible();
  await page.getByRole("button", { name: "承認" }).click();
  await expect(page.getByText("承認済み")).toBeVisible();

  const approved = await readRecord();
  const hash = spawnSync("node", [cli, "hash", "--repo", repo], { encoding: "utf8" }).stdout.trim();
  expect(approved).toMatchObject({ status: "approved", approved_hash: hash });
  const check = spawnSync("node", [cli, "check-approval", "--repo", repo, "--feature-dir", join(repo, FEATURE)], { encoding: "utf8" });
  expect(check.status).toBe(0);
});
```

`rdra-server/test/dist.test.ts` を次に置き換える（Web アプリが含まれていることと、`serve` が画面と API を返すことを追加）:

`rdra-server/test/dist.test.ts`:

```ts
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { makeRepo } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (f: string) => join(root, "dist", f);

beforeAll(() => {
  execFileSync("node", ["build.mjs"], { cwd: root, stdio: "ignore" });
}, 60_000);

describe("built bundles", () => {
  it("produces server.js, cli.js and the web app", () => {
    expect(existsSync(dist("server.js"))).toBe(true);
    expect(existsSync(dist("cli.js"))).toBe(true);
    expect(existsSync(dist("web/index.html"))).toBe(true);
  });

  it("serves the web app and API from the CLI", async () => {
    const repo = await makeRepo();
    const child = spawn("node", [dist("cli.js"), "serve", "--repo", repo], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const url = await new Promise<string>((resolve) => child.stdout!.once("data", (c) => resolve(JSON.parse(String(c)).url)));
      expect((await fetch(url)).headers.get("content-type")).toContain("text/html");
      expect((await fetch(new URL("api/state", url))).status).toBe(200);
    } finally {
      child.kill("SIGTERM");
    }
  }, 20_000);

  it("serves MCP tools over stdio", async () => {
    const repo = await makeRepo();
    const transport = new StdioClientTransport({ command: "node", args: [dist("server.js")], cwd: repo, stderr: "ignore" });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("rdra_get_model");
    } finally {
      await client.close();
    }
  }, 20_000);

  it("runs the CLI", async () => {
    const repo = await makeRepo();
    const res = spawnSync("node", [dist("cli.js"), "hash", "--repo", repo], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^sha256:/);
    expect(spawnSync("node", [dist("cli.js"), "nope"], { encoding: "utf8" }).status).toBe(64);
  });
});
```

`.gitignore` に追加する:

```
rdra-server/test-results/
rdra-server/playwright-report/
```

- [ ] **Step 3: すべてを確認する**

Run: `cd rdra-server && npm run typecheck && npm run build && npx vitest run && npx playwright test`
Expected: 型検査とビルドはエラーなし、vitest はすべて PASS（合計 116 件）、Playwright は 1 件 PASS

- [ ] **Step 4: コミットする**

```bash
git add .gitignore rdra-server/playwright.config.ts rdra-server/e2e rdra-server/test/dist.test.ts rdra-server/dist
git commit -m "Add end-to-end review test and ship the built web UI"
```

---

## 完了条件

- `cd rdra-server && npm run typecheck && npm run build && npx vitest run && npx playwright test` がすべて通る。
- Claude Code 上で `rdra_request_review` を呼ぶと実際の URL が返り、そこで図の確認・編集・承認・差し戻しができる。
- 承認すると `specs/<feature>/rdra-review.json` が `approved` になり、`node rdra-server/dist/cli.js check-approval` が 0 を返す。
