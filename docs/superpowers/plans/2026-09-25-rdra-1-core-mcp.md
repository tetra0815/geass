# RDRA 1/3: rdra-server コアと MCP 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `docs/rdra/*.yaml` を正本とする RDRA モデルを、AI が MCP ツールで読み書き・検証・差分確認・レビュー依頼でき、ゲート用 CLI が承認状態を判定できるようにする。

**Architecture:** `rdra-server/` に Node/TypeScript のパッケージを新設する。純粋関数のモジュール（スキーマ、YAML 入出力、ハッシュ、関連、検証、差分、操作の適用）を土台に、唯一の書き込み窓口 `RdraStore`、レビュー記録、MCP サーバー、CLI を積む。esbuild で `dist/server.js` と `dist/cli.js` の2ファイルにまとめ、plugin の `.mcp.json` から起動する。

**Tech Stack:** Node >= 22.13, TypeScript 7, zod 4, yaml 2, `@modelcontextprotocol/sdk` 1.30, `node:sqlite`, vitest 5, esbuild 0.28

**Spec:** `docs/superpowers/specs/2026-09-25-rdra-review-gate-design.md`

**この計画の範囲:** 設計書の 3 章（データモデル）、4 章（rdra-server の構成。ただし `http` モジュールを除く）、6 章（レビュー記録）、7.5 章のうち `check-approval` CLI、10 章のうちサーバーと CLI のビルド。Web アプリと HTTP は計画 2/3、パイプラインへの組み込みは計画 3/3。

## Global Constraints

- Node の下限は 22.13（`node:sqlite` をフラグなしで使えるため）。未満のときは `geass rdra-server には Node 22.13 以上が必要です（現在: <version>）` を出して終了する。
- `node:sqlite` は静的 import しない。`process.getBuiltinModule("node:sqlite")` で実行時に読む（古い Node でバンドルの読み込み自体が失敗し、バージョンエラーを出せなくなるのを防ぐ）。
- 正本は `docs/rdra/` の 8 ファイル: `actors.yaml` `external-systems.yaml` `bucs.yaml` `usecases.yaml` `screens.yaml` `events.yaml` `information.yaml` `states.yaml`。`layout/` はこの計画では扱わない。
- ID は `<接頭辞>.<スラッグ>`。接頭辞は `act` `ext` `buc` `uc` `scr` `evt` `inf` `st`。スラッグは `[a-z0-9]+(?:-[a-z0-9]+)*`。遷移参照は `st.<モデル>:<状態>-><状態>`。
- 承認ハッシュは `"sha256:" + hex`。キーをソートし、`null` / `undefined` / 空配列を落とし、要素を ID 順に並べた JSON から計算する。
- レビュー記録は `<feature dir>/rdra-review.json`。
- 分岐点コミットは `git config branch.<ブランチ名>.geass-base-commit`。
- `docs/rdra/` が存在しないプロジェクトでは、書き込みが起きるまでディレクトリを作らない（plugin はすべてのプロジェクトで MCP サーバーを起動するため）。
- ユーザー向けメッセージは日本語。コード識別子とコメントは英語。
- TypeScript の import は `.js` 拡張子付き（`module: NodeNext`）。
- テストはすべて `rdra-server/` で `npx vitest run` で実行する。git を使うテストは一時ディレクトリにリポジトリを作る。

## ファイル構成

```
.mcp.json                              plugin の MCP サーバー登録
.gitignore                             rdra-server/node_modules を除外
rdra-server/
  package.json  tsconfig.json  build.mjs
  src/
    version.ts                         サーバーのバージョン文字列
    node-version.ts                    Node の下限チェック
    model/kinds.ts                     要素種別の定義と zod スキーマ、Model 型
    model/io.ts                        YAML <-> Model、ファイル読み書き
    model/hash.ts                      正規化と承認ハッシュ
    model/relations.ts                 関連の抽出、関連種別の定義、遷移参照
    validate.ts                        整合性チェック
    diff.ts                            要素単位の差分
    git.ts                             git 呼び出し、分岐点、過去コミットのモデル
    feature.ts                         feature ディレクトリの解決
    query.ts                           SQLite インデックス
    operations.ts                      操作（upsert/delete/link/unlink）の純粋な適用
    store.ts                           唯一の書き込み窓口（直列化、検証、保存、監視）
    review.ts                          rdra-review.json と状態遷移
    mcp.ts                             MCP ツール定義
    cli.ts                             check-approval / wait-review / hash
    server.ts                          MCP サーバーの起動
    bin/server.ts  bin/cli.ts          バンドルのエントリ（バージョンチェック後に本体を読む）
  test/
    helpers.ts  fixtures.ts
    *.test.ts
  dist/                                ビルド成果物（コミットする）
```

---

### Task 1: パッケージの土台と要素種別の定義

**Files:**
- Create: `.gitignore`
- Create: `rdra-server/package.json`
- Create: `rdra-server/tsconfig.json`
- Create: `rdra-server/src/model/kinds.ts`
- Test: `rdra-server/test/kinds.test.ts`

**Interfaces:**
- Consumes: なし
- Produces:
  - `KIND_KEYS: readonly ["actors","externalSystems","bucs","usecases","screens","events","information","states"]`、`type KindKey`
  - `interface KindDef { key: KindKey; prefix: string; file: string; table: string; label: string; schema: z.ZodType }`
  - `KINDS: readonly KindDef[]`、`kindDef(key): KindDef`、`kindOfId(id): KindDef | undefined`
  - 型 `Actor` `ExternalSystem` `Buc` `Usecase` `Screen` `RdraEvent` `Information` `StateModel`、`interface Model`、`type AnyElement`
  - `emptyModel(): Model`、`findElement(model, id): { kind: KindDef; element: AnyElement; index: number } | undefined`
  - `SLUG: string`（正規表現の断片）

- [ ] **Step 1: パッケージを作る**

`.gitignore`（リポジトリ直下）:

```
rdra-server/node_modules/
```

`rdra-server/package.json`:

```json
{
  "name": "geass-rdra-server",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22.13" },
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p .",
    "build": "node build.mjs"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "1.30.1",
    "yaml": "^2.9.1",
    "zod": "^4.6.5"
  },
  "devDependencies": {
    "@types/node": "^22.13.0",
    "esbuild": "^0.28.2",
    "typescript": "^7.0.2",
    "vitest": "^5.0.1"
  }
}
```

`rdra-server/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "noEmit": true,
    "skipLibCheck": true,
    "types": ["node"]
  },
  "include": ["src", "test"]
}
```

Run: `cd rdra-server && npm install`
Expected: `package-lock.json` が作られ、エラーなく終わる。

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/kinds.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ActorSchema,
  KINDS,
  UsecaseSchema,
  StateModelSchema,
  emptyModel,
  findElement,
  kindOfId,
} from "../src/model/kinds.js";

describe("kinds", () => {
  it("accepts a well-formed actor", () => {
    expect(ActorSchema.parse({ id: "act.customer", name: "顧客" })).toEqual({ id: "act.customer", name: "顧客" });
  });

  it("rejects an id with the wrong prefix or a non-slug", () => {
    expect(ActorSchema.safeParse({ id: "uc.customer", name: "x" }).success).toBe(false);
    expect(ActorSchema.safeParse({ id: "act.Customer", name: "x" }).success).toBe(false);
    expect(ActorSchema.safeParse({ id: "act.customer", name: "" }).success).toBe(false);
  });

  it("rejects unknown fields", () => {
    expect(ActorSchema.safeParse({ id: "act.a", name: "A", extra: 1 }).success).toBe(false);
  });

  it("fills relation arrays with fresh empty arrays", () => {
    const a = UsecaseSchema.parse({ id: "uc.a", name: "A" });
    const b = UsecaseSchema.parse({ id: "uc.b", name: "B" });
    expect(a.actors).toEqual([]);
    expect(a.information).toEqual([]);
    expect(a.actors).not.toBe(b.actors);
  });

  it("requires an access type on usecase information refs", () => {
    expect(UsecaseSchema.safeParse({ id: "uc.a", name: "A", information: [{ ref: "inf.x" }] }).success).toBe(false);
    expect(UsecaseSchema.safeParse({ id: "uc.a", name: "A", information: [{ ref: "inf.x", access: "update" }] }).success).toBe(true);
  });

  it("requires state ids to be slugs", () => {
    expect(StateModelSchema.safeParse({ id: "st.o", name: "O", states: [{ id: "Draft", name: "d" }] }).success).toBe(false);
  });

  it("resolves kinds by id prefix", () => {
    expect(kindOfId("uc.place-order")?.key).toBe("usecases");
    expect(kindOfId("st.order")?.key).toBe("states");
    expect(kindOfId("zz.x")).toBeUndefined();
    expect(KINDS.map((k) => k.file)).toEqual([
      "actors.yaml",
      "external-systems.yaml",
      "bucs.yaml",
      "usecases.yaml",
      "screens.yaml",
      "events.yaml",
      "information.yaml",
      "states.yaml",
    ]);
  });

  it("finds elements across kinds", () => {
    const m = emptyModel();
    m.screens.push({ id: "scr.cart", name: "カート" });
    expect(findElement(m, "scr.cart")?.index).toBe(0);
    expect(findElement(m, "scr.none")).toBeUndefined();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/kinds.test.ts`
Expected: FAIL（`../src/model/kinds.js` が見つからない）

- [ ] **Step 4: 実装する**

`rdra-server/src/model/kinds.ts`:

```ts
import { z } from "zod";

export const SLUG = "[a-z0-9]+(?:-[a-z0-9]+)*";
const slugPattern = new RegExp(`^${SLUG}$`);

export const KIND_KEYS = [
  "actors",
  "externalSystems",
  "bucs",
  "usecases",
  "screens",
  "events",
  "information",
  "states",
] as const;
export type KindKey = (typeof KIND_KEYS)[number];

function idSchema(prefix: string) {
  return z.string().regex(new RegExp(`^${prefix}\\.${SLUG}$`), `id must look like ${prefix}.<slug>`);
}

function common(prefix: string) {
  return { id: idSchema(prefix), name: z.string().min(1), description: z.string().optional() };
}

const idList = () => z.array(z.string()).default(() => []);

export const AccessSchema = z.enum(["create", "read", "update", "delete"]);

export const ActorSchema = z.strictObject({ ...common("act") });
export const ExternalSystemSchema = z.strictObject({ ...common("ext") });
export const ScreenSchema = z.strictObject({ ...common("scr") });
export const BucSchema = z.strictObject({
  ...common("buc"),
  business: z.string().optional(),
  actors: idList(),
  usecases: idList(),
});
export const UsecaseSchema = z.strictObject({
  ...common("uc"),
  actors: idList(),
  screens: idList(),
  events: idList(),
  information: z.array(z.strictObject({ ref: z.string(), access: AccessSchema })).default(() => []),
  transitions: idList(),
});
export const EventSchema = z.strictObject({
  ...common("evt"),
  source: z.string().nullish(),
  target: z.string().nullish(),
});
export const InformationSchema = z.strictObject({
  ...common("inf"),
  attributes: z.array(z.string()).default(() => []),
  related: z.array(z.strictObject({ ref: z.string(), label: z.string().optional() })).default(() => []),
});
export const StateModelSchema = z.strictObject({
  ...common("st"),
  information: z.string().nullish(),
  states: z
    .array(z.strictObject({ id: z.string().regex(slugPattern, "state id must be a slug"), name: z.string().min(1) }))
    .default(() => []),
  transitions: z.array(z.strictObject({ from: z.string(), to: z.string() })).default(() => []),
});

export type Actor = z.output<typeof ActorSchema>;
export type ExternalSystem = z.output<typeof ExternalSystemSchema>;
export type Screen = z.output<typeof ScreenSchema>;
export type Buc = z.output<typeof BucSchema>;
export type Usecase = z.output<typeof UsecaseSchema>;
export type RdraEvent = z.output<typeof EventSchema>;
export type Information = z.output<typeof InformationSchema>;
export type StateModel = z.output<typeof StateModelSchema>;

export interface Model {
  actors: Actor[];
  externalSystems: ExternalSystem[];
  bucs: Buc[];
  usecases: Usecase[];
  screens: Screen[];
  events: RdraEvent[];
  information: Information[];
  states: StateModel[];
}
export type AnyElement = Model[KindKey][number];

export interface KindDef {
  key: KindKey;
  prefix: string;
  file: string;
  table: string;
  label: string;
  schema: z.ZodType;
}

export const KINDS: readonly KindDef[] = [
  { key: "actors", prefix: "act", file: "actors.yaml", table: "actors", label: "アクター", schema: ActorSchema },
  { key: "externalSystems", prefix: "ext", file: "external-systems.yaml", table: "external_systems", label: "外部システム", schema: ExternalSystemSchema },
  { key: "bucs", prefix: "buc", file: "bucs.yaml", table: "bucs", label: "BUC", schema: BucSchema },
  { key: "usecases", prefix: "uc", file: "usecases.yaml", table: "usecases", label: "ユースケース", schema: UsecaseSchema },
  { key: "screens", prefix: "scr", file: "screens.yaml", table: "screens", label: "画面", schema: ScreenSchema },
  { key: "events", prefix: "evt", file: "events.yaml", table: "events", label: "イベント", schema: EventSchema },
  { key: "information", prefix: "inf", file: "information.yaml", table: "information", label: "情報", schema: InformationSchema },
  { key: "states", prefix: "st", file: "states.yaml", table: "state_models", label: "状態モデル", schema: StateModelSchema },
];

export function kindDef(key: KindKey): KindDef {
  const def = KINDS.find((k) => k.key === key);
  if (!def) throw new Error(`unknown kind: ${key}`);
  return def;
}

export function kindOfId(id: string): KindDef | undefined {
  const prefix = id.split(/[.:]/, 1)[0];
  return KINDS.find((k) => k.prefix === prefix);
}

export function emptyModel(): Model {
  return { actors: [], externalSystems: [], bucs: [], usecases: [], screens: [], events: [], information: [], states: [] };
}

export function findElement(
  model: Model,
  id: string,
): { kind: KindDef; element: AnyElement; index: number } | undefined {
  const kind = kindOfId(id);
  if (!kind) return undefined;
  const list = model[kind.key] as AnyElement[];
  const index = list.findIndex((e) => e.id === id);
  return index >= 0 ? { kind, element: list[index], index } : undefined;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/kinds.test.ts && npx tsc -p .`
Expected: PASS（8 件）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add .gitignore rdra-server/package.json rdra-server/package-lock.json rdra-server/tsconfig.json rdra-server/src/model/kinds.ts rdra-server/test/kinds.test.ts
git commit -m "Add rdra-server package with RDRA element kinds"
```

---

### Task 2: YAML の読み書き

**Files:**
- Create: `rdra-server/src/model/io.ts`
- Create: `rdra-server/test/fixtures.ts`
- Test: `rdra-server/test/io.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `emptyModel`, `Model`, `AnyElement`（Task 1）
- Produces:
  - `RDRA_DIR = "docs/rdra"`、`type FileMap = Record<string, string>`（キーは `actors.yaml` などのファイル名）
  - `class ModelParseError extends Error { file: string; line: number | null; detail: string }`
  - `parseModel(files: FileMap): Model`（不正な内容は `ModelParseError` を投げる）
  - `serializeModel(model: Model): FileMap`（8 ファイルすべてを返す）
  - `readModelFiles(repoRoot: string): Promise<FileMap>`
  - `writeModelFiles(repoRoot: string, files: FileMap, previous: FileMap): Promise<string[]>`（変更されたファイル名を返す）
  - テスト用 `sampleFiles(): FileMap`、`sampleModel(): Model`（`test/fixtures.ts`）

- [ ] **Step 1: フィクスチャを作る**

`rdra-server/test/fixtures.ts`:

```ts
import { parseModel, type FileMap } from "../src/model/io.js";
import type { Model } from "../src/model/kinds.js";

export function sampleFiles(): FileMap {
  return {
    "actors.yaml": "- id: act.customer\n  name: 顧客\n",
    "external-systems.yaml": "- id: ext.payment-gateway\n  name: 決済代行\n",
    "bucs.yaml": [
      "- id: buc.ordering",
      "  name: 注文受付",
      "  business: 販売",
      "  actors: [act.customer]",
      "  usecases: [uc.place-order]",
      "",
    ].join("\n"),
    "usecases.yaml": [
      "- id: uc.place-order",
      "  name: 注文する",
      "  actors: [act.customer]",
      "  screens: [scr.cart]",
      "  events: [evt.payment-request]",
      "  information:",
      "    - { ref: inf.order, access: create }",
      "  transitions: [\"st.order:draft->placed\"]",
      "",
    ].join("\n"),
    "screens.yaml": "- id: scr.cart\n  name: カート\n",
    "events.yaml": "- id: evt.payment-request\n  name: 決済依頼\n  target: ext.payment-gateway\n",
    "information.yaml": "- id: inf.order\n  name: 注文\n  attributes: [注文番号]\n",
    "states.yaml": [
      "- id: st.order",
      "  name: 注文状態",
      "  information: inf.order",
      "  states:",
      "    - { id: draft, name: 下書き }",
      "    - { id: placed, name: 注文済み }",
      "  transitions:",
      "    - { from: draft, to: placed }",
      "",
    ].join("\n"),
  };
}

export function sampleModel(): Model {
  return parseModel(sampleFiles());
}
```

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/io.test.ts`:

```ts
import { mkdtemp, readFile, readdir, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ModelParseError,
  RDRA_DIR,
  parseModel,
  readModelFiles,
  serializeModel,
  writeModelFiles,
} from "../src/model/io.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

describe("parseModel", () => {
  it("parses every kind", () => {
    const m = sampleModel();
    expect(m.usecases[0].information).toEqual([{ ref: "inf.order", access: "create" }]);
    expect(m.states[0].transitions).toEqual([{ from: "draft", to: "placed" }]);
    expect(m.events[0].target).toBe("ext.payment-gateway");
  });

  it("treats missing and empty files as empty lists", () => {
    const m = parseModel({ "actors.yaml": "", "screens.yaml": "[]\n" });
    expect(m.actors).toEqual([]);
    expect(m.screens).toEqual([]);
    expect(m.usecases).toEqual([]);
  });

  it("reports YAML syntax errors with file and line", () => {
    const err = (() => {
      try {
        parseModel({ "actors.yaml": "- id: act.a\n  name: [\n" });
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(ModelParseError);
    expect((err as ModelParseError).file).toBe("actors.yaml");
    expect((err as ModelParseError).line).toBeGreaterThan(0);
  });

  it("reports schema errors with the item path and line", () => {
    const err = (() => {
      try {
        parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n- id: bad id\n  name: B\n" });
      } catch (e) {
        return e;
      }
    })() as ModelParseError;
    expect(err).toBeInstanceOf(ModelParseError);
    expect(err.line).toBe(3);
    expect(err.detail).toContain("[1.id]");
  });

  it("rejects a file whose top level is not a list", () => {
    expect(() => parseModel({ "actors.yaml": "id: act.a\n" })).toThrow(ModelParseError);
  });
});

describe("serializeModel", () => {
  it("round-trips the sample model", () => {
    const m = sampleModel();
    expect(parseModel(serializeModel(m))).toEqual(m);
  });

  it("omits empty relation arrays and writes empty kinds as []", () => {
    const files = serializeModel(parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n" }));
    expect(files["usecases.yaml"]).toBe("- id: uc.a\n  name: A\n");
    expect(files["actors.yaml"]).toBe("[]\n");
    expect(Object.keys(files)).toHaveLength(8);
  });
});

describe("file io", () => {
  it("reads nothing from a repo without docs/rdra", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    expect(await readModelFiles(dir)).toEqual({});
  });

  it("writes only changed files and creates the directory", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    const files = serializeModel(sampleModel());
    const written = await writeModelFiles(dir, files, {});
    expect(written).toHaveLength(8);
    expect((await readdir(join(dir, RDRA_DIR))).sort()).toHaveLength(8);

    const changed = { ...files, "screens.yaml": "- id: scr.top\n  name: トップ\n" };
    expect(await writeModelFiles(dir, changed, files)).toEqual(["screens.yaml"]);
    expect(await readFile(join(dir, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.top");
    expect(await readModelFiles(dir)).toEqual(changed);
  });

  it("reads files that exist on disk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "rdra-io-"));
    await mkdir(join(dir, RDRA_DIR), { recursive: true });
    await writeFile(join(dir, RDRA_DIR, "actors.yaml"), sampleFiles()["actors.yaml"]);
    expect(await readModelFiles(dir)).toEqual({ "actors.yaml": sampleFiles()["actors.yaml"] });
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/io.test.ts`
Expected: FAIL（`../src/model/io.js` が見つからない）

- [ ] **Step 4: 実装する**

`rdra-server/src/model/io.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LineCounter, parseDocument, stringify, type Document } from "yaml";
import { KINDS, emptyModel, type AnyElement, type Model } from "./kinds.js";

export const RDRA_DIR = "docs/rdra";
export type FileMap = Record<string, string>;

export class ModelParseError extends Error {
  constructor(
    readonly file: string,
    readonly line: number | null,
    readonly detail: string,
  ) {
    super(`${file}${line ? `:${line}` : ""}: ${detail}`);
    this.name = "ModelParseError";
  }
}

function lineOf(doc: Document, counter: LineCounter, path: (string | number)[]): number | null {
  for (let n = path.length; n > 0; n--) {
    const node = doc.getIn(path.slice(0, n), true) as { range?: [number, number, number] } | undefined;
    if (node && node.range) return counter.linePos(node.range[0]).line;
  }
  return null;
}

export function parseModel(files: FileMap): Model {
  const model = emptyModel();
  for (const kind of KINDS) {
    const text = files[kind.file];
    if (text === undefined || text.trim() === "") continue;
    const counter = new LineCounter();
    const doc = parseDocument(text, { lineCounter: counter });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      throw new ModelParseError(kind.file, first.linePos?.[0]?.line ?? null, first.message);
    }
    const data: unknown = doc.toJS();
    if (data === null || data === undefined) continue;
    if (!Array.isArray(data)) throw new ModelParseError(kind.file, 1, "top level must be a list");
    data.forEach((raw, i) => {
      const result = kind.schema.safeParse(raw);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = [i, ...issue.path.filter((p): p is string | number => typeof p !== "symbol")];
        throw new ModelParseError(kind.file, lineOf(doc, counter, path), `[${path.join(".")}] ${issue.message}`);
      }
      (model[kind.key] as AnyElement[]).push(result.data as AnyElement);
    });
  }
  return model;
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = prune(v);
    }
    return out;
  }
  return value;
}

export function serializeModel(model: Model): FileMap {
  const files: FileMap = {};
  for (const kind of KINDS) {
    const items = model[kind.key];
    files[kind.file] = items.length === 0 ? "[]\n" : stringify(prune(items), { lineWidth: 0 });
  }
  return files;
}

export async function readModelFiles(repoRoot: string): Promise<FileMap> {
  const files: FileMap = {};
  for (const kind of KINDS) {
    try {
      files[kind.file] = await readFile(join(repoRoot, RDRA_DIR, kind.file), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return files;
}

export async function writeModelFiles(repoRoot: string, files: FileMap, previous: FileMap): Promise<string[]> {
  const changed = Object.keys(files).filter((file) => previous[file] !== files[file]);
  if (changed.length === 0) return [];
  await mkdir(join(repoRoot, RDRA_DIR), { recursive: true });
  for (const file of changed) {
    await writeFile(join(repoRoot, RDRA_DIR, file), files[file], "utf8");
  }
  return changed;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/io.test.ts && npx tsc -p .`
Expected: PASS（10 件）

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/src/model/io.ts rdra-server/test/fixtures.ts rdra-server/test/io.test.ts
git commit -m "Add YAML read/write for the RDRA model"
```

---

### Task 3: 正規化と承認ハッシュ

**Files:**
- Create: `rdra-server/src/model/hash.ts`
- Test: `rdra-server/test/hash.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `Model`（Task 1）、`parseModel`（Task 2）
- Produces:
  - `canonicalize(value: unknown): unknown`（キーのソート、`null`/`undefined`/空配列の除去）
  - `canonicalModel(model: Model): Record<string, unknown>`（各種別を ID 順に並べる）
  - `modelHash(model: Model): string`（`"sha256:<hex>"`）

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/hash.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { modelHash } from "../src/model/hash.js";
import { parseModel } from "../src/model/io.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

describe("modelHash", () => {
  it("has the sha256 prefix", () => {
    expect(modelHash(sampleModel())).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  it("ignores key order, whitespace and comments", () => {
    const files = sampleFiles();
    files["actors.yaml"] = "# people\n-   name: 顧客\n    id: act.customer\n\n";
    expect(modelHash(parseModel(files))).toBe(modelHash(sampleModel()));
  });

  it("ignores element order within a file", () => {
    const a = parseModel({ "screens.yaml": "- id: scr.a\n  name: A\n- id: scr.b\n  name: B\n" });
    const b = parseModel({ "screens.yaml": "- id: scr.b\n  name: B\n- id: scr.a\n  name: A\n" });
    expect(modelHash(a)).toBe(modelHash(b));
  });

  it("treats an omitted relation list like an empty one", () => {
    const a = parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n" });
    const b = parseModel({ "usecases.yaml": "- id: uc.a\n  name: A\n  actors: []\n" });
    expect(modelHash(a)).toBe(modelHash(b));
  });

  it("changes when meaning changes", () => {
    const files = sampleFiles();
    files["actors.yaml"] = "- id: act.customer\n  name: 会員\n";
    expect(modelHash(parseModel(files))).not.toBe(modelHash(sampleModel()));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/hash.test.ts`
Expected: FAIL（`../src/model/hash.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/model/hash.ts`:

```ts
import { createHash } from "node:crypto";
import { KINDS, type Model } from "./kinds.js";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalModel(model: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of KINDS) {
    out[kind.key] = [...model[kind.key]]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(canonicalize);
  }
  return out;
}

export function modelHash(model: Model): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonicalModel(model))).digest("hex");
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/hash.test.ts`
Expected: PASS（5 件）

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/model/hash.ts rdra-server/test/hash.test.ts
git commit -m "Add canonical approval hash for the RDRA model"
```

---

### Task 4: 関連の抽出と整合性チェック

**Files:**
- Create: `rdra-server/src/model/relations.ts`
- Create: `rdra-server/src/validate.ts`
- Test: `rdra-server/test/validate.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `Model`, `AnyElement`, `SLUG`（Task 1）、`parseModel`（Task 2）
- Produces:
  - `RELATION_KINDS`（下記 11 種の readonly タプル）、`type RelationKind`
  - `RELATION_FIELDS: Record<RelationKind, { field: string; shape: "ids" | "refs" | "single" }>`
  - `RELATION_TARGET_PREFIXES: Record<RelationKind, readonly string[]>`
  - `interface Relation { from: string; to: string; kind: RelationKind; attrs: Record<string, string> }`
  - `relationsOf(model: Model): Relation[]`
  - `interface TransitionRef { model: string; from: string; to: string }`、`parseTransitionRef(ref): TransitionRef | null`、`formatTransitionRef(t): string`
  - `interface Issue { level: "error" | "warning"; code: string; message: string; elementId?: string }`
  - `validate(model: Model): Issue[]`、`hasErrors(issues: Issue[]): boolean`

関連種別の一覧（名前は「起点の接頭辞.意味」）:

| RelationKind | 起点のフィールド | 形 | 参照先 |
|---|---|---|---|
| `buc.actor` | `bucs[].actors` | ids | `act` |
| `buc.usecase` | `bucs[].usecases` | ids | `uc` |
| `uc.actor` | `usecases[].actors` | ids | `act` |
| `uc.screen` | `usecases[].screens` | ids | `scr` |
| `uc.event` | `usecases[].events` | ids | `evt` |
| `uc.information` | `usecases[].information` | refs（`{ref, access}`） | `inf` |
| `uc.transition` | `usecases[].transitions` | ids（遷移参照） | `st` |
| `evt.source` | `events[].source` | single | `act`, `ext` |
| `evt.target` | `events[].target` | single | `act`, `ext` |
| `inf.related` | `information[].related` | refs（`{ref, label?}`） | `inf` |
| `st.information` | `states[].information` | single | `inf` |

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/validate.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseModel } from "../src/model/io.js";
import { formatTransitionRef, parseTransitionRef, relationsOf } from "../src/model/relations.js";
import { hasErrors, validate } from "../src/validate.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

const codes = (files: Record<string, string>) => validate(parseModel(files)).map((i) => `${i.level}:${i.code}:${i.elementId ?? ""}`);

describe("relationsOf", () => {
  it("extracts every relation of the sample model with attrs", () => {
    const rels = relationsOf(sampleModel());
    expect(rels).toContainEqual({ from: "uc.place-order", to: "inf.order", kind: "uc.information", attrs: { access: "create" } });
    expect(rels).toContainEqual({ from: "uc.place-order", to: "st.order:draft->placed", kind: "uc.transition", attrs: {} });
    expect(rels).toContainEqual({ from: "evt.payment-request", to: "ext.payment-gateway", kind: "evt.target", attrs: {} });
    expect(rels).toContainEqual({ from: "st.order", to: "inf.order", kind: "st.information", attrs: {} });
    expect(rels).toHaveLength(9);
  });
});

describe("transition refs", () => {
  it("parses and formats", () => {
    expect(parseTransitionRef("st.order:draft->placed")).toEqual({ model: "st.order", from: "draft", to: "placed" });
    expect(parseTransitionRef("st.order:draft")).toBeNull();
    expect(formatTransitionRef({ model: "st.order", from: "a", to: "b" })).toBe("st.order:a->b");
  });
});

describe("validate", () => {
  it("finds no issues in the sample model", () => {
    expect(validate(sampleModel())).toEqual([]);
  });

  it("flags duplicate ids", () => {
    const files = sampleFiles();
    files["actors.yaml"] += "- id: act.customer\n  name: 重複\n";
    expect(codes(files)).toContain("error:duplicate-id:act.customer");
  });

  it("flags dangling and wrong-kind references", () => {
    const files = sampleFiles();
    files["bucs.yaml"] = "- id: buc.ordering\n  name: 注文受付\n  actors: [act.ghost, scr.cart]\n  usecases: [uc.place-order]\n";
    const c = codes(files);
    expect(c).toContain("error:dangling-ref:buc.ordering");
    expect(c).toContain("error:wrong-kind-ref:buc.ordering");
  });

  it("flags transition refs to unknown models, unknown transitions and bad syntax", () => {
    const files = sampleFiles();
    files["usecases.yaml"] = [
      "- id: uc.place-order",
      "  name: 注文する",
      "  screens: [scr.cart]",
      "  information: [{ ref: inf.order, access: create }]",
      "  transitions: [\"st.ghost:a->b\", \"st.order:placed->draft\", \"st.order\"]",
      "",
    ].join("\n");
    const c = codes(files);
    expect(c).toContain("error:dangling-ref:uc.place-order");
    expect(c).toContain("error:unknown-transition:uc.place-order");
    expect(c).toContain("error:bad-transition-ref:uc.place-order");
  });

  it("flags state models whose transitions use undeclared or duplicate states", () => {
    const files = sampleFiles();
    files["states.yaml"] = [
      "- id: st.order",
      "  name: 注文状態",
      "  states: [{ id: draft, name: a }, { id: draft, name: b }, { id: placed, name: c }]",
      "  transitions: [{ from: draft, to: placed }, { from: draft, to: shipped }]",
      "",
    ].join("\n");
    const c = codes(files);
    expect(c).toContain("error:duplicate-state:st.order");
    expect(c).toContain("error:unknown-state:st.order");
  });

  it("warns about loose ends without making them errors", () => {
    const files = {
      "usecases.yaml": "- id: uc.lonely\n  name: 孤立\n",
      "information.yaml": "- id: inf.unused\n  name: 未使用\n",
      "states.yaml": "- id: st.s\n  name: S\n  states: [{ id: a, name: A }, { id: b, name: B }]\n  transitions: [{ from: a, to: b }]\n",
    };
    const issues = validate(parseModel(files));
    expect(hasErrors(issues)).toBe(false);
    expect(issues.map((i) => i.code).sort()).toEqual([
      "unused-information",
      "unused-transition",
      "usecase-without-buc",
      "usecase-without-io",
    ]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/validate.test.ts`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: 関連モジュールを実装する**

`rdra-server/src/model/relations.ts`:

```ts
import { KINDS, SLUG, type AnyElement, type Model } from "./kinds.js";

export const RELATION_KINDS = [
  "buc.actor",
  "buc.usecase",
  "uc.actor",
  "uc.screen",
  "uc.event",
  "uc.information",
  "uc.transition",
  "evt.source",
  "evt.target",
  "inf.related",
  "st.information",
] as const;
export type RelationKind = (typeof RELATION_KINDS)[number];

export const RELATION_FIELDS: Record<RelationKind, { field: string; shape: "ids" | "refs" | "single" }> = {
  "buc.actor": { field: "actors", shape: "ids" },
  "buc.usecase": { field: "usecases", shape: "ids" },
  "uc.actor": { field: "actors", shape: "ids" },
  "uc.screen": { field: "screens", shape: "ids" },
  "uc.event": { field: "events", shape: "ids" },
  "uc.information": { field: "information", shape: "refs" },
  "uc.transition": { field: "transitions", shape: "ids" },
  "evt.source": { field: "source", shape: "single" },
  "evt.target": { field: "target", shape: "single" },
  "inf.related": { field: "related", shape: "refs" },
  "st.information": { field: "information", shape: "single" },
};

export const RELATION_TARGET_PREFIXES: Record<RelationKind, readonly string[]> = {
  "buc.actor": ["act"],
  "buc.usecase": ["uc"],
  "uc.actor": ["act"],
  "uc.screen": ["scr"],
  "uc.event": ["evt"],
  "uc.information": ["inf"],
  "uc.transition": ["st"],
  "evt.source": ["act", "ext"],
  "evt.target": ["act", "ext"],
  "inf.related": ["inf"],
  "st.information": ["inf"],
};

export interface Relation {
  from: string;
  to: string;
  kind: RelationKind;
  attrs: Record<string, string>;
}

export function relationSourcePrefix(kind: RelationKind): string {
  return kind.split(".")[0];
}

export function elementFields(element: AnyElement): Record<string, unknown> {
  return element as unknown as Record<string, unknown>;
}

export function relationsOf(model: Model): Relation[] {
  const relations: Relation[] = [];
  for (const kind of RELATION_KINDS) {
    const { field, shape } = RELATION_FIELDS[kind];
    const source = KINDS.find((k) => k.prefix === relationSourcePrefix(kind));
    if (!source) continue;
    for (const element of model[source.key] as AnyElement[]) {
      const value = elementFields(element)[field];
      if (shape === "ids") {
        for (const to of value as string[]) relations.push({ from: element.id, to, kind, attrs: {} });
      } else if (shape === "refs") {
        for (const entry of value as Record<string, string>[]) {
          const { ref, ...attrs } = entry;
          relations.push({ from: element.id, to: ref, kind, attrs });
        }
      } else if (typeof value === "string") {
        relations.push({ from: element.id, to: value, kind, attrs: {} });
      }
    }
  }
  return relations;
}

export interface TransitionRef {
  model: string;
  from: string;
  to: string;
}

const transitionPattern = new RegExp(`^(st\\.${SLUG}):(${SLUG})->(${SLUG})$`);

export function parseTransitionRef(ref: string): TransitionRef | null {
  const m = transitionPattern.exec(ref);
  return m ? { model: m[1], from: m[2], to: m[3] } : null;
}

export function formatTransitionRef(t: TransitionRef): string {
  return `${t.model}:${t.from}->${t.to}`;
}
```

- [ ] **Step 4: 検証モジュールを実装する**

`rdra-server/src/validate.ts`:

```ts
import { KINDS, type Model } from "./model/kinds.js";
import {
  RELATION_TARGET_PREFIXES,
  formatTransitionRef,
  parseTransitionRef,
  relationsOf,
} from "./model/relations.js";

export interface Issue {
  level: "error" | "warning";
  code: string;
  message: string;
  elementId?: string;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

export function validate(model: Model): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, elementId?: string) => issues.push({ level: "error", code, message, elementId });
  const warn = (code: string, message: string, elementId?: string) => issues.push({ level: "warning", code, message, elementId });

  const ids = new Set<string>();
  for (const kind of KINDS) {
    for (const element of model[kind.key]) {
      if (ids.has(element.id)) error("duplicate-id", `ID ${element.id} が重複しています`, element.id);
      ids.add(element.id);
    }
  }

  const stateModels = new Map(model.states.map((s) => [s.id, s]));
  for (const sm of model.states) {
    const stateIds = new Set<string>();
    for (const state of sm.states) {
      if (stateIds.has(state.id)) error("duplicate-state", `${sm.id} の状態 ${state.id} が重複しています`, sm.id);
      stateIds.add(state.id);
    }
    for (const t of sm.transitions) {
      if (!stateIds.has(t.from) || !stateIds.has(t.to)) {
        error("unknown-state", `${sm.id} の遷移 ${t.from}->${t.to} が未定義の状態を参照しています`, sm.id);
      }
    }
  }

  for (const r of relationsOf(model)) {
    if (r.kind === "uc.transition") {
      const t = parseTransitionRef(r.to);
      if (!t) {
        error("bad-transition-ref", `${r.from} の遷移参照 ${r.to} の形式が不正です（st.<モデル>:<状態>-><状態>）`, r.from);
        continue;
      }
      const sm = stateModels.get(t.model);
      if (!sm) {
        error("dangling-ref", `${r.from} が存在しない状態モデル ${t.model} を参照しています`, r.from);
      } else if (!sm.transitions.some((x) => x.from === t.from && x.to === t.to)) {
        error("unknown-transition", `${r.from} が ${t.model} に存在しない遷移 ${t.from}->${t.to} を参照しています`, r.from);
      }
      continue;
    }
    const allowed = RELATION_TARGET_PREFIXES[r.kind];
    if (!allowed.includes(r.to.split(".")[0])) {
      error("wrong-kind-ref", `${r.from} の ${r.kind} に ${r.to} は指定できません（${allowed.join(" / ")} のみ）`, r.from);
      continue;
    }
    if (!ids.has(r.to)) error("dangling-ref", `${r.from} が存在しない ${r.to} を参照しています`, r.from);
  }

  const inBuc = new Set(model.bucs.flatMap((b) => b.usecases));
  const usedInformation = new Set(model.usecases.flatMap((u) => u.information.map((i) => i.ref)));
  const usedTransitions = new Set(model.usecases.flatMap((u) => u.transitions));
  for (const uc of model.usecases) {
    if (uc.screens.length === 0 && uc.events.length === 0) {
      warn("usecase-without-io", `${uc.id} に画面もイベントも紐づいていません`, uc.id);
    }
    if (!inBuc.has(uc.id)) warn("usecase-without-buc", `${uc.id} がどの BUC にも属していません`, uc.id);
  }
  for (const info of model.information) {
    if (!usedInformation.has(info.id)) warn("unused-information", `${info.id} を扱うユースケースがありません`, info.id);
  }
  for (const sm of model.states) {
    for (const t of sm.transitions) {
      const ref = formatTransitionRef({ model: sm.id, from: t.from, to: t.to });
      if (!usedTransitions.has(ref)) warn("unused-transition", `${ref} を起こすユースケースがありません`, sm.id);
    }
  }
  return issues;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/validate.test.ts && npx tsc -p .`
Expected: PASS（8 件）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/src/model/relations.ts rdra-server/src/validate.ts rdra-server/test/validate.test.ts
git commit -m "Add relation extraction and RDRA model validation"
```

---

### Task 5: 要素単位の差分

**Files:**
- Create: `rdra-server/src/diff.ts`
- Test: `rdra-server/test/diff.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `Model`, `AnyElement`, `KindKey`（Task 1）、`canonicalize`（Task 3）
- Produces:
  - `type ChangeType = "added" | "removed" | "modified"`
  - `interface ElementChange { id: string; kind: KindKey; type: ChangeType; fields: string[]; before?: AnyElement; after?: AnyElement }`
  - `diffModels(base: Model, head: Model): ElementChange[]`（`fields` は変更されたフィールド名のソート済み一覧。追加・削除では空）

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/diff.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { diffModels } from "../src/diff.js";
import { emptyModel } from "../src/model/kinds.js";
import { parseModel } from "../src/model/io.js";
import { sampleFiles, sampleModel } from "./fixtures.js";

describe("diffModels", () => {
  it("reports nothing for identical models", () => {
    expect(diffModels(sampleModel(), sampleModel())).toEqual([]);
  });

  it("reports everything as added against an empty base", () => {
    const changes = diffModels(emptyModel(), sampleModel());
    expect(changes).toHaveLength(8);
    expect(changes.every((c) => c.type === "added" && c.after && !c.before)).toBe(true);
  });

  it("reports modified fields, including relation changes", () => {
    const files = sampleFiles();
    files["usecases.yaml"] = files["usecases.yaml"]
      .replace("name: 注文する", "name: 注文を確定する")
      .replace("access: create", "access: update");
    const changes = diffModels(sampleModel(), parseModel(files));
    expect(changes).toEqual([
      expect.objectContaining({ id: "uc.place-order", kind: "usecases", type: "modified", fields: ["information", "name"] }),
    ]);
  });

  it("reports removed elements", () => {
    const files = sampleFiles();
    files["screens.yaml"] = "[]\n";
    const changes = diffModels(sampleModel(), parseModel(files));
    expect(changes).toContainEqual(expect.objectContaining({ id: "scr.cart", type: "removed", fields: [] }));
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/diff.test.ts`
Expected: FAIL（`../src/diff.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/diff.ts`:

```ts
import { canonicalize } from "./model/hash.js";
import { KINDS, type AnyElement, type KindKey, type Model } from "./model/kinds.js";

export type ChangeType = "added" | "removed" | "modified";

export interface ElementChange {
  id: string;
  kind: KindKey;
  type: ChangeType;
  fields: string[];
  before?: AnyElement;
  after?: AnyElement;
}

export function diffModels(base: Model, head: Model): ElementChange[] {
  const changes: ElementChange[] = [];
  for (const kind of KINDS) {
    const before = new Map((base[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    const after = new Map((head[kind.key] as AnyElement[]).map((e) => [e.id, e]));
    for (const [id, next] of after) {
      const prev = before.get(id);
      if (!prev) {
        changes.push({ id, kind: kind.key, type: "added", fields: [], after: next });
        continue;
      }
      const a = canonicalize(prev) as Record<string, unknown>;
      const b = canonicalize(next) as Record<string, unknown>;
      const fields = [...new Set([...Object.keys(a), ...Object.keys(b)])]
        .filter((f) => JSON.stringify(a[f]) !== JSON.stringify(b[f]))
        .sort();
      if (fields.length > 0) changes.push({ id, kind: kind.key, type: "modified", fields, before: prev, after: next });
    }
    for (const [id, prev] of before) {
      if (!after.has(id)) changes.push({ id, kind: kind.key, type: "removed", fields: [], before: prev });
    }
  }
  return changes;
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/diff.test.ts`
Expected: PASS（4 件）

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/diff.ts rdra-server/test/diff.test.ts
git commit -m "Add element-level diff between RDRA models"
```

---

### Task 6: git と feature ディレクトリの解決

**Files:**
- Create: `rdra-server/src/git.ts`
- Create: `rdra-server/src/feature.ts`
- Create: `rdra-server/test/helpers.ts`
- Test: `rdra-server/test/git.test.ts`

**Interfaces:**
- Consumes: `KINDS`（Task 1）、`RDRA_DIR`, `FileMap`（Task 2）
- Produces:
  - `git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }>`
  - `repoRootOf(dir: string): Promise<string | null>`
  - `currentBranch(repoRoot: string): Promise<string | null>`
  - `rootWorktreeBranch(repoRoot: string): Promise<string | null>`
  - `baseCommitConfigKey(branch: string): string`（`branch.<b>.geass-base-commit`）
  - `resolveBaseCommit(repoRoot: string): Promise<string | null>`
  - `readModelFilesAt(repoRoot: string, commit: string): Promise<FileMap>`
  - `lastCommitTouching(repoRoot: string, path: string): Promise<string | null>`
  - `resolveFeatureDir(repoRoot: string, env?: NodeJS.ProcessEnv): Promise<string | null>`（絶対パス）
  - テスト用 `makeRepo(files?: Record<string, string>): Promise<string>`、`run(cwd: string, cmd: string, args: string[]): string`（`test/helpers.ts`）

`resolveBaseCommit` の順序: (1) 現在のブランチの `geass-base-commit` 設定（コミットとして解決できる場合）、(2) ルート worktree のブランチが現在のブランチと異なれば `git merge-base HEAD <それ>`、(3) `null`。

`resolveFeatureDir` の順序: (1) `env.SPECIFY_FEATURE_DIRECTORY`、(2) `.geass/feature.json` の `feature_directory`、(3) 現在のブランチ名が `^\d{8}-\d{6}-[a-z0-9-]+$` か `^\d{3}-[a-z0-9-]+$` なら `specs/<ブランチ名>`、(4) `null`。相対パスはリポジトリのルートからの相対とみなす。

- [ ] **Step 1: テスト用のヘルパーを作る**

`rdra-server/test/helpers.ts`:

```ts
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function run(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

export async function makeRepo(files: Record<string, string> = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-repo-")));
  run(dir, "git", ["init", "-q", "-b", "main"]);
  run(dir, "git", ["config", "user.email", "test@example.com"]);
  run(dir, "git", ["config", "user.name", "test"]);
  run(dir, "git", ["config", "commit.gpgsign", "false"]);
  await writeFiles(dir, { "README.md": "test\n", ...files });
  run(dir, "git", ["add", "-A"]);
  run(dir, "git", ["commit", "-q", "-m", "init"]);
  return dir;
}
```

- [ ] **Step 2: 失敗するテストを書く**

`rdra-server/test/git.test.ts`:

```ts
import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFeatureDir } from "../src/feature.js";
import {
  baseCommitConfigKey,
  currentBranch,
  lastCommitTouching,
  readModelFilesAt,
  repoRootOf,
  resolveBaseCommit,
  rootWorktreeBranch,
} from "../src/git.js";
import { makeRepo, run, writeFiles } from "./helpers.js";

describe("git helpers", () => {
  it("returns null outside a repository", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-nogit-")));
    expect(await repoRootOf(dir)).toBeNull();
  });

  it("finds the repo root and branches", async () => {
    const repo = await makeRepo();
    expect(await repoRootOf(join(repo))).toBe(repo);
    expect(await currentBranch(repo)).toBe("main");
    expect(await rootWorktreeBranch(repo)).toBe("main");
  });

  it("prefers the recorded base commit", async () => {
    const repo = await makeRepo();
    const base = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    await writeFiles(repo, { "a.txt": "a" });
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "work"]);
    run(repo, "git", ["config", baseCommitConfigKey("20260925-120000-demo"), base]);
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("falls back to merge-base with the root worktree branch", async () => {
    const repo = await makeRepo();
    const base = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    const wt = join(repo, ".wt");
    run(repo, "git", ["worktree", "add", "-q", "-b", "feat", wt]);
    await writeFiles(wt, { "b.txt": "b" });
    run(wt, "git", ["add", "-A"]);
    run(wt, "git", ["commit", "-q", "-m", "feat work"]);
    expect(await resolveBaseCommit(wt)).toBe(base);
  });

  it("returns null when there is nothing to compare against", async () => {
    const repo = await makeRepo();
    expect(await resolveBaseCommit(repo)).toBeNull();
  });

  it("reads model files at a commit and finds the last commit touching a path", async () => {
    const repo = await makeRepo({ "docs/rdra/actors.yaml": "- id: act.a\n  name: A\n" });
    const head = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    expect(await readModelFilesAt(repo, head)).toEqual({ "actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await lastCommitTouching(repo, "docs/rdra/actors.yaml")).toBe(head);
    expect(await lastCommitTouching(repo, "nothing.txt")).toBeNull();
  });
});

describe("resolveFeatureDir", () => {
  it("uses the environment variable first", async () => {
    const repo = await makeRepo();
    expect(await resolveFeatureDir(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/x" })).toBe(join(repo, "specs/x"));
  });

  it("uses .geass/feature.json next", async () => {
    const repo = await makeRepo({ ".geass/feature.json": '{"feature_directory":"specs/001-demo"}' });
    expect(await resolveFeatureDir(repo, {})).toBe(join(repo, "specs/001-demo"));
  });

  it("derives the directory from a feature branch name", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    expect(await resolveFeatureDir(repo, {})).toBe(join(repo, "specs/20260925-120000-demo"));
  });

  it("returns null on a non-feature branch", async () => {
    const repo = await makeRepo();
    expect(await resolveFeatureDir(repo, {})).toBeNull();
  });
});
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/git.test.ts`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 4: git モジュールを実装する**

`rdra-server/src/git.ts`:

```ts
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RDRA_DIR, type FileMap } from "./model/io.js";
import { KINDS } from "./model/kinds.js";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export async function repoRootOf(dir: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok ? r.stdout.trim() : null;
}

export async function currentBranch(repoRoot: string): Promise<string | null> {
  const r = await git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export async function rootWorktreeBranch(repoRoot: string): Promise<string | null> {
  const r = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("branch refs/heads/")) return line.slice("branch refs/heads/".length);
    if (line === "detached" || line === "") return null;
  }
  return null;
}

export function baseCommitConfigKey(branch: string): string {
  return `branch.${branch}.geass-base-commit`;
}

export async function resolveBaseCommit(repoRoot: string): Promise<string | null> {
  const branch = await currentBranch(repoRoot);
  if (branch) {
    const configured = await git(repoRoot, ["config", "--get", baseCommitConfigKey(branch)]);
    const value = configured.stdout.trim();
    if (configured.ok && value) {
      const verified = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${value}^{commit}`]);
      if (verified.ok) return verified.stdout.trim();
    }
  }
  const root = await rootWorktreeBranch(repoRoot);
  if (root && root !== branch) {
    const mb = await git(repoRoot, ["merge-base", "HEAD", root]);
    if (mb.ok && mb.stdout.trim()) return mb.stdout.trim();
  }
  return null;
}

export async function readModelFilesAt(repoRoot: string, commit: string): Promise<FileMap> {
  const files: FileMap = {};
  for (const kind of KINDS) {
    const r = await git(repoRoot, ["show", `${commit}:${RDRA_DIR}/${kind.file}`]);
    if (r.ok) files[kind.file] = r.stdout;
  }
  return files;
}

export async function lastCommitTouching(repoRoot: string, path: string): Promise<string | null> {
  const r = await git(repoRoot, ["log", "-1", "--format=%H", "--", path]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}
```

- [ ] **Step 5: feature モジュールを実装する**

`rdra-server/src/feature.ts`:

```ts
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
```

- [ ] **Step 6: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/git.test.ts && npx tsc -p .`
Expected: PASS（10 件）、tsc はエラーなし

- [ ] **Step 7: コミットする**

```bash
git add rdra-server/src/git.ts rdra-server/src/feature.ts rdra-server/test/helpers.ts rdra-server/test/git.test.ts
git commit -m "Add git base-commit and feature directory resolution"
```

---

### Task 7: SQLite インデックス

**Files:**
- Create: `rdra-server/src/query.ts`
- Test: `rdra-server/test/query.test.ts`

**Interfaces:**
- Consumes: `KINDS`, `Model`（Task 1）、`relationsOf`, `formatTransitionRef`（Task 4）
- Produces:
  - `class QueryIndex { rebuild(model: Model): void; query(sql: string): Record<string, unknown>[] }`
  - テーブル: `elements(id, kind, name, description, data)`、`relations(from_id, to_id, kind, attrs)`、`state_nodes(model_id, state_id, name)`、`state_transitions(model_id, from_state, to_state, ref)`
  - ビュー: `KindDef.table` の名前（`actors`, `external_systems`, `bucs`, `usecases`, `screens`, `events`, `information`, `state_models`）。`elements` を種別で絞ったもの。
  - `rebuild` の後は `PRAGMA query_only = ON` なので、`query` での書き込みはエラーになる。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/query.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { QueryIndex } from "../src/query.js";
import { sampleModel } from "./fixtures.js";

describe("QueryIndex", () => {
  it("answers relation queries", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    const rows = index.query(
      "SELECT r.from_id, json_extract(r.attrs, '$.access') AS access FROM relations r WHERE r.to_id = 'inf.order' AND r.kind = 'uc.information'",
    );
    expect(rows).toEqual([{ from_id: "uc.place-order", access: "create" }]);
  });

  it("exposes one view per kind and the state tables", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    expect(index.query("SELECT id, name FROM usecases")).toEqual([{ id: "uc.place-order", name: "注文する" }]);
    expect(index.query("SELECT count(*) AS n FROM state_nodes")).toEqual([{ n: 2 }]);
    expect(index.query("SELECT ref FROM state_transitions")).toEqual([{ ref: "st.order:draft->placed" }]);
  });

  it("rejects writes", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    expect(() => index.query("DELETE FROM elements")).toThrow();
    expect(index.query("SELECT count(*) AS n FROM elements")).toEqual([{ n: 8 }]);
  });

  it("replaces previous content on rebuild", () => {
    const index = new QueryIndex();
    index.rebuild(sampleModel());
    const m = sampleModel();
    m.screens = [];
    index.rebuild(m);
    expect(index.query("SELECT count(*) AS n FROM screens")).toEqual([{ n: 0 }]);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/query.test.ts`
Expected: FAIL（`../src/query.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/query.ts`:

```ts
import type { DatabaseSync } from "node:sqlite";
import { KINDS, type AnyElement, type Model } from "./model/kinds.js";
import { formatTransitionRef, relationsOf } from "./model/relations.js";

function openDatabase(): DatabaseSync {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(":memory:");
}

export class QueryIndex {
  private readonly db: DatabaseSync;

  constructor() {
    this.db = openDatabase();
    this.db.exec(`
      CREATE TABLE elements (id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT, data TEXT NOT NULL);
      CREATE TABLE relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, attrs TEXT NOT NULL);
      CREATE TABLE state_nodes (model_id TEXT NOT NULL, state_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE state_transitions (model_id TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL, ref TEXT NOT NULL);
      ${KINDS.map((k) => `CREATE VIEW ${k.table} AS SELECT * FROM elements WHERE kind = '${k.key}';`).join("\n")}
    `);
  }

  rebuild(model: Model): void {
    this.db.exec("PRAGMA query_only = OFF");
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM elements; DELETE FROM relations; DELETE FROM state_nodes; DELETE FROM state_transitions;");
      const insertElement = this.db.prepare("INSERT INTO elements VALUES (?, ?, ?, ?, ?)");
      for (const kind of KINDS) {
        for (const e of model[kind.key] as AnyElement[]) {
          insertElement.run(e.id, kind.key, e.name, e.description ?? null, JSON.stringify(e));
        }
      }
      const insertRelation = this.db.prepare("INSERT INTO relations VALUES (?, ?, ?, ?)");
      for (const r of relationsOf(model)) insertRelation.run(r.from, r.to, r.kind, JSON.stringify(r.attrs));
      const insertState = this.db.prepare("INSERT INTO state_nodes VALUES (?, ?, ?)");
      const insertTransition = this.db.prepare("INSERT INTO state_transitions VALUES (?, ?, ?, ?)");
      for (const sm of model.states) {
        for (const s of sm.states) insertState.run(sm.id, s.id, s.name);
        for (const t of sm.transitions) {
          insertTransition.run(sm.id, t.from, t.to, formatTransitionRef({ model: sm.id, from: t.from, to: t.to }));
        }
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.db.exec("PRAGMA query_only = ON");
    }
  }

  query(sql: string): Record<string, unknown>[] {
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/query.test.ts && npx tsc -p .`
Expected: PASS（4 件）。`ExperimentalWarning: SQLite is an experimental feature` が標準エラーに出るのは想定どおり。

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/query.ts rdra-server/test/query.test.ts
git commit -m "Add read-only SQLite index over the RDRA model"
```

---

### Task 8: 操作の適用（純粋関数）

**Files:**
- Create: `rdra-server/src/operations.ts`
- Test: `rdra-server/test/operations.test.ts`

**Interfaces:**
- Consumes: `kindDef`, `findElement`, `emptyModel`, `KindKey`, `Model`, `AnyElement`（Task 1）、`RELATION_FIELDS`, `relationSourcePrefix`, `elementFields`, `relationsOf`, `parseTransitionRef`, `Relation`, `RelationKind`（Task 4）
- Produces:
  - `type Operation =`
    - `{ op: "upsert"; kind: KindKey; element: Record<string, unknown> }`（ID が既存なら指定フィールドだけ上書きするマージ、なければ追加）
    - `{ op: "delete"; id: string }`（その要素を参照する関連も同時に外す）
    - `{ op: "link"; relation: RelationKind; from: string; to: string; attrs?: Record<string, string> }`
    - `{ op: "unlink"; relation: RelationKind; from: string; to: string }`
  - `class OperationError extends Error`
  - `applyOperations(model: Model, ops: Operation[]): { model: Model; removedRelations: Relation[] }`（入力の `model` は変更しない）

参照先の存在や種別はここでは検査しない（`validate` の役割。Task 9 の `RdraStore` が適用後に検証する）。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/operations.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { OperationError, applyOperations } from "../src/operations.js";
import { sampleModel } from "./fixtures.js";

describe("applyOperations", () => {
  it("adds a new element with defaults and leaves the input untouched", () => {
    const input = sampleModel();
    const { model } = applyOperations(input, [{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    expect(model.screens.map((s) => s.id)).toEqual(["scr.cart", "scr.top"]);
    expect(input.screens).toHaveLength(1);
  });

  it("merges fields into an existing element", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "usecases", element: { id: "uc.place-order", description: "カートの内容で注文を確定する" } },
    ]);
    const uc = model.usecases[0];
    expect(uc.name).toBe("注文する");
    expect(uc.description).toBe("カートの内容で注文を確定する");
    expect(uc.screens).toEqual(["scr.cart"]);
  });

  it("rejects schema violations with the element id in the message", () => {
    expect(() =>
      applyOperations(sampleModel(), [{ op: "upsert", kind: "actors", element: { id: "act.x", name: "" } }]),
    ).toThrow(/act\.x/);
    expect(() => applyOperations(sampleModel(), [{ op: "upsert", kind: "actors", element: { name: "x" } }])).toThrow(OperationError);
  });

  it("deletes an element and every relation pointing at it", () => {
    const { model, removedRelations } = applyOperations(sampleModel(), [{ op: "delete", id: "inf.order" }]);
    expect(model.information).toEqual([]);
    expect(model.usecases[0].information).toEqual([]);
    expect(model.states[0].information).toBeUndefined();
    expect(removedRelations.map((r) => `${r.from}>${r.to}`).sort()).toEqual(["st.order>inf.order", "uc.place-order>inf.order"]);
  });

  it("deleting a state model removes usecase transitions into it", () => {
    const { model } = applyOperations(sampleModel(), [{ op: "delete", id: "st.order" }]);
    expect(model.usecases[0].transitions).toEqual([]);
  });

  it("deleting an element also reports its own outgoing relations", () => {
    const { removedRelations } = applyOperations(sampleModel(), [{ op: "delete", id: "evt.payment-request" }]);
    expect(removedRelations.map((r) => r.kind).sort()).toEqual(["evt.target", "uc.event"]);
  });

  it("rejects deleting an unknown id", () => {
    expect(() => applyOperations(sampleModel(), [{ op: "delete", id: "scr.none" }])).toThrow(OperationError);
  });

  it("links ids, refs with attrs, and single fields", () => {
    const { model } = applyOperations(sampleModel(), [
      { op: "upsert", kind: "screens", element: { id: "scr.confirm", name: "確認" } },
      { op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.confirm" },
      { op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.confirm" },
      { op: "link", relation: "uc.information", from: "uc.place-order", to: "inf.order", attrs: { access: "update" } },
      { op: "link", relation: "evt.source", from: "evt.payment-request", to: "act.customer" },
    ]);
    const uc = model.usecases[0];
    expect(uc.screens).toEqual(["scr.cart", "scr.confirm"]);
    expect(uc.information).toEqual([{ ref: "inf.order", access: "update" }]);
    expect(model.events[0].source).toBe("act.customer");
  });

  it("rejects links from the wrong kind or with missing attrs", () => {
    expect(() =>
      applyOperations(sampleModel(), [{ op: "link", relation: "uc.screen", from: "buc.ordering", to: "scr.cart" }]),
    ).toThrow(OperationError);
    expect(() =>
      applyOperations(sampleModel(), [{ op: "upsert", kind: "information", element: { id: "inf.stock", name: "在庫" } }, { op: "link", relation: "uc.information", from: "uc.place-order", to: "inf.stock" }]),
    ).toThrow(/access/);
  });

  it("unlinks and rejects unlinking a missing relation", () => {
    const { model } = applyOperations(sampleModel(), [{ op: "unlink", relation: "uc.screen", from: "uc.place-order", to: "scr.cart" }]);
    expect(model.usecases[0].screens).toEqual([]);
    expect(() =>
      applyOperations(sampleModel(), [{ op: "unlink", relation: "uc.screen", from: "uc.place-order", to: "scr.none" }]),
    ).toThrow(OperationError);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/operations.test.ts`
Expected: FAIL（`../src/operations.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/operations.ts`:

```ts
import { emptyModel, findElement, kindDef, type AnyElement, type KindKey, type Model } from "./model/kinds.js";
import {
  RELATION_FIELDS,
  elementFields,
  parseTransitionRef,
  relationSourcePrefix,
  relationsOf,
  type Relation,
  type RelationKind,
} from "./model/relations.js";

export type Operation =
  | { op: "upsert"; kind: KindKey; element: Record<string, unknown> }
  | { op: "delete"; id: string }
  | { op: "link"; relation: RelationKind; from: string; to: string; attrs?: Record<string, string> }
  | { op: "unlink"; relation: RelationKind; from: string; to: string };

export class OperationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OperationError";
  }
}

function formatIssues(id: string, issues: { path: PropertyKey[]; message: string }[]): string {
  return `${id}: ${issues.map((i) => `${i.path.map(String).join(".") || "(root)"} ${i.message}`).join("; ")}`;
}

function reparse(model: Model, id: string): void {
  const found = findElement(model, id);
  if (!found) throw new OperationError(`${id} は存在しません`);
  const result = found.kind.schema.safeParse(found.element);
  if (!result.success) throw new OperationError(formatIssues(id, result.error.issues));
  (model[found.kind.key] as AnyElement[])[found.index] = result.data as AnyElement;
}

function upsert(model: Model, key: KindKey, patch: Record<string, unknown>): void {
  const id = patch.id;
  if (typeof id !== "string" || id === "") throw new OperationError("upsert には id が必要です");
  const def = kindDef(key);
  const list = model[key] as AnyElement[];
  const index = list.findIndex((e) => e.id === id);
  const merged = index >= 0 ? { ...list[index], ...patch } : patch;
  const result = def.schema.safeParse(merged);
  if (!result.success) throw new OperationError(formatIssues(id, result.error.issues));
  if (index >= 0) list[index] = result.data as AnyElement;
  else list.push(result.data as AnyElement);
}

function detach(model: Model, relation: RelationKind, from: string, to: string): boolean {
  const found = findElement(model, from);
  if (!found) return false;
  const fields = elementFields(found.element);
  const { field, shape } = RELATION_FIELDS[relation];
  if (shape === "ids") {
    const list = fields[field] as string[];
    const index = list.indexOf(to);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }
  if (shape === "refs") {
    const list = fields[field] as { ref: string }[];
    const index = list.findIndex((x) => x.ref === to);
    if (index < 0) return false;
    list.splice(index, 1);
    return true;
  }
  if (fields[field] !== to) return false;
  delete fields[field];
  return true;
}

function pointsAt(r: Relation, id: string): boolean {
  if (r.to === id) return true;
  return r.kind === "uc.transition" && parseTransitionRef(r.to)?.model === id;
}

function remove(model: Model, id: string): Relation[] {
  const found = findElement(model, id);
  if (!found) throw new OperationError(`${id} は存在しません`);
  const single = emptyModel();
  (single[found.kind.key] as AnyElement[]).push(found.element);
  const outgoing = relationsOf(single);
  (model[found.kind.key] as AnyElement[]).splice(found.index, 1);
  const incoming = relationsOf(model).filter((r) => pointsAt(r, id));
  for (const r of incoming) detach(model, r.kind, r.from, r.to);
  return [...outgoing, ...incoming];
}

function link(model: Model, relation: RelationKind, from: string, to: string, attrs: Record<string, string> = {}): void {
  const prefix = relationSourcePrefix(relation);
  if (!from.startsWith(`${prefix}.`)) throw new OperationError(`${relation} の起点は ${prefix}.* である必要があります（指定: ${from}）`);
  const found = findElement(model, from);
  if (!found) throw new OperationError(`${from} は存在しません`);
  const fields = elementFields(found.element);
  const { field, shape } = RELATION_FIELDS[relation];
  if (shape === "ids") {
    const list = fields[field] as string[];
    if (!list.includes(to)) list.push(to);
  } else if (shape === "refs") {
    const list = fields[field] as Record<string, unknown>[];
    const existing = list.find((x) => x.ref === to);
    if (existing) Object.assign(existing, attrs);
    else list.push({ ref: to, ...attrs });
  } else {
    fields[field] = to;
  }
  reparse(model, from);
}

export function applyOperations(input: Model, ops: Operation[]): { model: Model; removedRelations: Relation[] } {
  const model = structuredClone(input);
  const removedRelations: Relation[] = [];
  for (const op of ops) {
    switch (op.op) {
      case "upsert":
        upsert(model, op.kind, op.element);
        break;
      case "delete":
        removedRelations.push(...remove(model, op.id));
        break;
      case "link":
        link(model, op.relation, op.from, op.to, op.attrs);
        break;
      case "unlink":
        if (!detach(model, op.relation, op.from, op.to)) {
          throw new OperationError(`${op.from} から ${op.to} への ${op.relation} は存在しません`);
        }
        break;
    }
  }
  return { model, removedRelations };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/operations.test.ts && npx tsc -p .`
Expected: PASS（10 件）、tsc はエラーなし

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/operations.ts rdra-server/test/operations.test.ts
git commit -m "Add pure operation application for RDRA edits"
```

---

### Task 9: RdraStore（唯一の書き込み窓口）

**Files:**
- Create: `rdra-server/src/store.ts`
- Test: `rdra-server/test/store.test.ts`

**Interfaces:**
- Consumes: `emptyModel`, `Model`（Task 1）、`RDRA_DIR`, `FileMap`, `ModelParseError`, `parseModel`, `serializeModel`, `readModelFiles`, `writeModelFiles`（Task 2）、`modelHash`（Task 3）、`validate`, `Issue`, `Relation`（Task 4）、`applyOperations`, `OperationError`, `Operation`（Task 8）
- Produces:
  - `type ApplyResult = { ok: true; version: string; removedRelations: Relation[] } | { ok: false; reason: "conflict" | "parse-error" | "invalid-operation" | "introduces-errors"; message: string; issues?: Issue[] }`
  - `interface StoreChange { version: string; parseError: string | null }`
  - `class RdraStore extends EventEmitter`
    - `static open(repoRoot: string): Promise<RdraStore>`
    - `readonly repoRoot: string`、`get model(): Model`、`get version(): string`、`get parseError(): ModelParseError | null`
    - `apply(ops: Operation[], opts?: { expectedVersion?: string }): Promise<ApplyResult>`
    - `reload(): Promise<void>`
    - `watch(): void`、`close(): void`
    - イベント `"change"`（引数 `StoreChange`）。バージョンが変わったとき、または構文エラーの状態が変わったときだけ発火する。

振る舞い:
- `apply` と `reload` は Promise のキューで直列に実行する。
- 構文エラーの状態では `apply` を `parse-error` で拒否する。
- `expectedVersion` が現在の版と違えば `conflict`。
- 適用後の検証で、適用前になかったエラーが1件でも増えたら `introduces-errors` で拒否し、ファイルは変更しない（もともとあったエラーは編集の妨げにしない）。
- `watch` は `docs/rdra/` が存在するときだけ監視を始める。存在しなければ、最初の書き込みの後に始める。変更は 100ms まとめてから `reload` する。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/store.test.ts`:

```ts
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RDRA_DIR } from "../src/model/io.js";
import { RdraStore, type StoreChange } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeRepo } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const stores: RdraStore[] = [];
async function openStore(repo: string) {
  const s = await RdraStore.open(repo);
  stores.push(s);
  return s;
}
afterEach(() => {
  while (stores.length) stores.pop()!.close();
});

function nextChange(store: RdraStore, timeoutMs = 3000): Promise<StoreChange> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("no change event")), timeoutMs);
    store.once("change", (c: StoreChange) => {
      clearTimeout(timer);
      resolve(c);
    });
  });
}

describe("RdraStore", () => {
  it("opens an empty model without creating docs/rdra", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    store.watch();
    expect(store.model.usecases).toEqual([]);
    await expect(stat(join(repo, RDRA_DIR))).rejects.toThrow();
  });

  it("applies operations, writes YAML, bumps the version and emits change", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const before = store.version;
    const changed = nextChange(store);
    const result = await store.apply([{ op: "upsert", kind: "actors", element: { id: "act.customer", name: "顧客" } }]);
    expect(result.ok).toBe(true);
    expect(store.version).not.toBe(before);
    expect((await changed).version).toBe(store.version);
    expect(await readFile(join(repo, RDRA_DIR, "actors.yaml"), "utf8")).toBe("- id: act.customer\n  name: 顧客\n");
  });

  it("rejects stale versions", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const result = await store.apply([{ op: "upsert", kind: "actors", element: { id: "act.a", name: "A" } }], { expectedVersion: "sha256:old" });
    expect(result).toMatchObject({ ok: false, reason: "conflict" });
  });

  it("rejects operations that introduce errors and leaves files untouched", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    const before = await readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8");
    const result = await store.apply([{ op: "link", relation: "uc.screen", from: "uc.place-order", to: "scr.ghost" }]);
    expect(result).toMatchObject({ ok: false, reason: "introduces-errors" });
    expect(await readFile(join(repo, RDRA_DIR, "usecases.yaml"), "utf8")).toBe(before);
  });

  it("reports invalid operations", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    expect(await store.apply([{ op: "delete", id: "act.none" }])).toMatchObject({ ok: false, reason: "invalid-operation" });
  });

  it("serializes concurrent applies", async () => {
    const repo = await makeRepo();
    const store = await openStore(repo);
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, i) => store.apply([{ op: "upsert", kind: "screens", element: { id: `scr.s${i}`, name: `S${i}` } }])),
    );
    expect(results.every((r) => r.ok)).toBe(true);
    expect(store.model.screens).toHaveLength(10);
  });

  it("keeps the last good model on YAML errors, blocks edits, and recovers", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    const good = store.version;
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), "- id: act.a\n  name: [\n");
    await store.reload();
    expect(store.parseError?.file).toBe("actors.yaml");
    expect(store.version).toBe(good);
    expect(await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.x", name: "X" } }])).toMatchObject({
      ok: false,
      reason: "parse-error",
    });
    await writeFile(join(repo, RDRA_DIR, "actors.yaml"), sampleFiles()["actors.yaml"]);
    await store.reload();
    expect(store.parseError).toBeNull();
  });

  it("reloads when files change on disk", async () => {
    const repo = await makeRepo(rdraFiles());
    const store = await openStore(repo);
    store.watch();
    await new Promise((r) => setTimeout(r, 200));
    const changed = nextChange(store);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.top\n  name: トップ\n");
    await changed;
    expect(store.model.screens.map((s) => s.id)).toEqual(["scr.top"]);
  });
});
```

注: 「reloads when files change on disk」でのサンプルモデルは、`scr.cart` を消すと `uc.place-order` に dangling-ref のエラーが出るが、外部編集は拒否せずそのまま読み込む（外部編集の検証は画面と `rdra_validate` で見せる）。

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/store.test.ts`
Expected: FAIL（`../src/store.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/store.ts`:

```ts
import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { modelHash } from "./model/hash.js";
import {
  ModelParseError,
  RDRA_DIR,
  parseModel,
  readModelFiles,
  serializeModel,
  writeModelFiles,
  type FileMap,
} from "./model/io.js";
import { emptyModel, type Model } from "./model/kinds.js";
import type { Relation } from "./model/relations.js";
import { OperationError, applyOperations, type Operation } from "./operations.js";
import { validate, type Issue } from "./validate.js";

export type ApplyResult =
  | { ok: true; version: string; removedRelations: Relation[] }
  | {
      ok: false;
      reason: "conflict" | "parse-error" | "invalid-operation" | "introduces-errors";
      message: string;
      issues?: Issue[];
    };

export interface StoreChange {
  version: string;
  parseError: string | null;
}

const issueKey = (i: Issue) => `${i.code}|${i.elementId ?? ""}|${i.message}`;

export class RdraStore extends EventEmitter {
  private current: Model = emptyModel();
  private files: FileMap = {};
  private currentVersion = modelHash(emptyModel());
  private error: ModelParseError | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private watching = false;
  private reloadTimer: NodeJS.Timeout | null = null;

  private constructor(readonly repoRoot: string) {
    super();
  }

  static async open(repoRoot: string): Promise<RdraStore> {
    const store = new RdraStore(repoRoot);
    await store.reload();
    return store;
  }

  get model(): Model {
    return this.current;
  }

  get version(): string {
    return this.currentVersion;
  }

  get parseError(): ModelParseError | null {
    return this.error;
  }

  reload(): Promise<void> {
    return this.enqueue(() => this.reloadNow());
  }

  apply(ops: Operation[], opts: { expectedVersion?: string } = {}): Promise<ApplyResult> {
    return this.enqueue(() => this.applyNow(ops, opts));
  }

  watch(): void {
    this.watching = true;
    this.startWatcher();
  }

  close(): void {
    this.watching = false;
    this.watcher?.close();
    this.watcher = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  private startWatcher(): void {
    if (!this.watching || this.watcher) return;
    const dir = join(this.repoRoot, RDRA_DIR);
    if (!existsSync(dir)) return;
    this.watcher = watch(dir, () => this.scheduleReload());
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reload();
    }, 100);
  }

  private emitChange(): void {
    const change: StoreChange = { version: this.currentVersion, parseError: this.error?.message ?? null };
    this.emit("change", change);
  }

  private async reloadNow(): Promise<void> {
    const files = await readModelFiles(this.repoRoot);
    let model: Model;
    try {
      model = parseModel(files);
    } catch (e) {
      if (!(e instanceof ModelParseError)) throw e;
      const changed = this.error?.message !== e.message;
      this.error = e;
      if (changed) this.emitChange();
      return;
    }
    const version = modelHash(model);
    const recovered = this.error !== null;
    this.error = null;
    this.files = files;
    this.current = model;
    if (version !== this.currentVersion || recovered) {
      this.currentVersion = version;
      this.emitChange();
    }
  }

  private async applyNow(ops: Operation[], opts: { expectedVersion?: string }): Promise<ApplyResult> {
    if (this.error) {
      return { ok: false, reason: "parse-error", message: `YAML を修正するまで編集できません: ${this.error.message}` };
    }
    if (opts.expectedVersion && opts.expectedVersion !== this.currentVersion) {
      return { ok: false, reason: "conflict", message: "モデルが更新されています。最新の状態を読み込み直してください" };
    }
    let next: { model: Model; removedRelations: Relation[] };
    try {
      next = applyOperations(this.current, ops);
    } catch (e) {
      if (e instanceof OperationError) return { ok: false, reason: "invalid-operation", message: e.message };
      throw e;
    }
    const existing = new Set(validate(this.current).filter((i) => i.level === "error").map(issueKey));
    const introduced = validate(next.model).filter((i) => i.level === "error" && !existing.has(issueKey(i)));
    if (introduced.length > 0) {
      return { ok: false, reason: "introduces-errors", message: introduced.map((i) => i.message).join("\n"), issues: introduced };
    }
    const files = serializeModel(next.model);
    await writeModelFiles(this.repoRoot, files, this.files);
    this.files = files;
    this.current = next.model;
    const version = modelHash(next.model);
    if (version !== this.currentVersion) {
      this.currentVersion = version;
      this.emitChange();
    }
    this.startWatcher();
    return { ok: true, version, removedRelations: next.removedRelations };
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/store.test.ts && npx tsc -p .`
Expected: PASS（8 件）、tsc はエラーなし。ファイル監視のテストは、監視開始から 200ms 待ってから書き込む（macOS の FSEvents は開始直後の変更を取りこぼすことがある）。

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/store.ts rdra-server/test/store.test.ts
git commit -m "Add RdraStore as the single serialized writer"
```

---

### Task 10: レビュー記録

**Files:**
- Create: `rdra-server/src/review.ts`
- Test: `rdra-server/test/review.test.ts`

**Interfaces:**
- Consumes: なし（純粋な JSON とファイル I/O）
- Produces:
  - `REVIEW_FILE = "rdra-review.json"`
  - `type ReviewStatus = "none" | "pending" | "approved" | "rejected"`
  - `interface ReviewComment { target: string | null; text: string }`
  - `interface ReviewRound { decision: "approved" | "rejected"; decided_at: string; hash: string; comments: ReviewComment[] }`
  - `interface ReviewRecord { status: ReviewStatus; base_commit: string | null; approved_hash: string | null; requested_at: string | null; decided_at: string | null; rounds: ReviewRound[] }`
  - `emptyReview(): ReviewRecord`
  - `readReview(featureDir: string): Promise<ReviewRecord>`（ファイルがなければ `emptyReview()`）
  - `writeReview(featureDir: string, record: ReviewRecord): Promise<void>`（ディレクトリがなければ作る）
  - `class ReviewError extends Error`
  - `requestReview(record, opts: { now: string; baseCommit: string | null }): ReviewRecord`
  - `decide(record, opts: { decision: "approved" | "rejected"; comments: ReviewComment[]; hash: string; now: string }): ReviewRecord`
  - `type ApprovalState = { state: "approved" } | { state: "none" | "pending" | "rejected" } | { state: "stale"; approvedHash: string; currentHash: string }`
  - `approvalState(record, currentHash: string): ApprovalState`

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/review.test.ts`:

```ts
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  REVIEW_FILE,
  ReviewError,
  approvalState,
  decide,
  emptyReview,
  readReview,
  requestReview,
  writeReview,
} from "../src/review.js";

const T1 = "2026-09-25T10:00:00+09:00";
const T2 = "2026-09-25T10:05:00+09:00";

describe("review record", () => {
  it("reads an empty record when the file is missing and round-trips on write", async () => {
    const dir = join(await mkdtemp(join(tmpdir(), "rdra-review-")), "specs", "001-x");
    expect(await readReview(dir)).toEqual(emptyReview());
    const rec = requestReview(emptyReview(), { now: T1, baseCommit: "abc" });
    await writeReview(dir, rec);
    expect(JSON.parse(await readFile(join(dir, REVIEW_FILE), "utf8"))).toEqual(rec);
    expect(await readReview(dir)).toEqual(rec);
  });

  it("walks through request, reject, request, approve", () => {
    let rec = requestReview(emptyReview(), { now: T1, baseCommit: "abc" });
    expect(rec).toMatchObject({ status: "pending", requested_at: T1, base_commit: "abc", approved_hash: null });
    rec = decide(rec, { decision: "rejected", comments: [{ target: "uc.a", text: "直して" }], hash: "sha256:1", now: T2 });
    expect(rec).toMatchObject({ status: "rejected", decided_at: T2, approved_hash: null });
    rec = requestReview(rec, { now: T2, baseCommit: "abc" });
    expect(rec.status).toBe("pending");
    rec = decide(rec, { decision: "approved", comments: [], hash: "sha256:2", now: T2 });
    expect(rec).toMatchObject({ status: "approved", approved_hash: "sha256:2" });
    expect(rec.rounds.map((r) => r.decision)).toEqual(["rejected", "approved"]);
  });

  it("clears a previous approval when a new review is requested", () => {
    let rec = decide(requestReview(emptyReview(), { now: T1, baseCommit: null }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    rec = requestReview(rec, { now: T2, baseCommit: null });
    expect(rec).toMatchObject({ status: "pending", approved_hash: null, decided_at: null });
  });

  it("refuses decisions without a pending review and rejections without comments", () => {
    expect(() => decide(emptyReview(), { decision: "approved", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
    const pending = requestReview(emptyReview(), { now: T1, baseCommit: null });
    expect(() => decide(pending, { decision: "rejected", comments: [], hash: "h", now: T1 })).toThrow(ReviewError);
  });

  it("computes the approval state against the current hash", () => {
    const approved = decide(requestReview(emptyReview(), { now: T1, baseCommit: null }), { decision: "approved", comments: [], hash: "sha256:1", now: T1 });
    expect(approvalState(approved, "sha256:1")).toEqual({ state: "approved" });
    expect(approvalState(approved, "sha256:2")).toEqual({ state: "stale", approvedHash: "sha256:1", currentHash: "sha256:2" });
    expect(approvalState(emptyReview(), "sha256:1")).toEqual({ state: "none" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/review.test.ts`
Expected: FAIL（`../src/review.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/review.ts`:

```ts
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export const REVIEW_FILE = "rdra-review.json";

export type ReviewStatus = "none" | "pending" | "approved" | "rejected";

export interface ReviewComment {
  target: string | null;
  text: string;
}

export interface ReviewRound {
  decision: "approved" | "rejected";
  decided_at: string;
  hash: string;
  comments: ReviewComment[];
}

export interface ReviewRecord {
  status: ReviewStatus;
  base_commit: string | null;
  approved_hash: string | null;
  requested_at: string | null;
  decided_at: string | null;
  rounds: ReviewRound[];
}

export type ApprovalState =
  | { state: "approved" }
  | { state: "none" | "pending" | "rejected" }
  | { state: "stale"; approvedHash: string; currentHash: string };

export class ReviewError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewError";
  }
}

export function emptyReview(): ReviewRecord {
  return { status: "none", base_commit: null, approved_hash: null, requested_at: null, decided_at: null, rounds: [] };
}

export async function readReview(featureDir: string): Promise<ReviewRecord> {
  let text: string;
  try {
    text = await readFile(join(featureDir, REVIEW_FILE), "utf8");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return emptyReview();
    throw e;
  }
  return { ...emptyReview(), ...(JSON.parse(text) as Partial<ReviewRecord>) };
}

export async function writeReview(featureDir: string, record: ReviewRecord): Promise<void> {
  await mkdir(featureDir, { recursive: true });
  await writeFile(join(featureDir, REVIEW_FILE), JSON.stringify(record, null, 2) + "\n", "utf8");
}

export function requestReview(record: ReviewRecord, opts: { now: string; baseCommit: string | null }): ReviewRecord {
  return {
    ...record,
    status: "pending",
    base_commit: opts.baseCommit,
    approved_hash: null,
    requested_at: opts.now,
    decided_at: null,
  };
}

export function decide(
  record: ReviewRecord,
  opts: { decision: "approved" | "rejected"; comments: ReviewComment[]; hash: string; now: string },
): ReviewRecord {
  if (record.status !== "pending") throw new ReviewError("レビューが依頼されていません");
  if (opts.decision === "rejected" && opts.comments.length === 0) throw new ReviewError("差し戻しにはコメントが必要です");
  const round: ReviewRound = { decision: opts.decision, decided_at: opts.now, hash: opts.hash, comments: opts.comments };
  return {
    ...record,
    status: opts.decision,
    decided_at: opts.now,
    approved_hash: opts.decision === "approved" ? opts.hash : null,
    rounds: [...record.rounds, round],
  };
}

export function approvalState(record: ReviewRecord, currentHash: string): ApprovalState {
  if (record.status !== "approved") return { state: record.status };
  if (record.approved_hash === currentHash) return { state: "approved" };
  return { state: "stale", approvedHash: record.approved_hash ?? "", currentHash };
}
```

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/review.test.ts`
Expected: PASS（5 件）

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/review.ts rdra-server/test/review.test.ts
git commit -m "Add RDRA review record and approval state"
```

---

### Task 11: MCP ツール

**Files:**
- Create: `rdra-server/src/version.ts`
- Create: `rdra-server/src/mcp.ts`
- Test: `rdra-server/test/mcp.test.ts`

**Interfaces:**
- Consumes: `KIND_KEYS`（Task 1）、`parseModel`, `ModelParseError`（Task 2）、`RELATION_KINDS`（Task 4）、`validate`, `hasErrors`（Task 4）、`diffModels`（Task 5）、`resolveBaseCommit`, `readModelFilesAt`（Task 6）、`resolveFeatureDir`（Task 6）、`QueryIndex`（Task 7）、`Operation`（Task 8）、`RdraStore`（Task 9）、`readReview`, `writeReview`, `requestReview`, `approvalState`, `REVIEW_FILE`（Task 10）
- Produces:
  - `SERVER_VERSION = "0.11.0"`（`src/version.ts`）
  - `interface McpDeps { store: RdraStore; index: QueryIndex; reviewUrl: () => string | null; now?: () => string; env?: NodeJS.ProcessEnv }`
  - `createMcpServer(deps: McpDeps): McpServer`
  - ツール名: `rdra_get_model`, `rdra_query`, `rdra_validate`, `rdra_diff`, `rdra_upsert`, `rdra_delete`, `rdra_link`, `rdra_unlink`, `rdra_request_review`, `rdra_review_status`
  - すべてのツールは結果を JSON テキスト1件で返す。失敗は `isError: true` とメッセージ。
  - 承認・差し戻しのツールは作らない（設計書 7.5「承認記録の保護」）。

計画 2/3 で `reviewUrl` が Web の URL を返すようになる。この計画では `() => null` を渡し、`rdra_request_review` は `url: null` を返す。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/mcp.test.ts`:

```ts
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { createMcpServer } from "../src/mcp.js";
import { RDRA_DIR } from "../src/model/io.js";
import { QueryIndex } from "../src/query.js";
import { REVIEW_FILE } from "../src/review.js";
import { RdraStore } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeRepo, run } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function connect(repo: string, env: NodeJS.ProcessEnv = {}) {
  const store = await RdraStore.open(repo);
  cleanups.push(() => store.close());
  const server = createMcpServer({ store, index: new QueryIndex(), reviewUrl: () => null, now: () => "2026-09-25T10:00:00+09:00", env });
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

describe("MCP tools", () => {
  it("lists every tool and no approval tool", async () => {
    const { client } = await connect(await makeRepo());
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "rdra_delete",
      "rdra_diff",
      "rdra_get_model",
      "rdra_link",
      "rdra_query",
      "rdra_request_review",
      "rdra_review_status",
      "rdra_unlink",
      "rdra_upsert",
      "rdra_validate",
    ]);
  });

  it("upserts, links, reads, queries and validates", async () => {
    const { call } = await connect(await makeRepo());
    expect(
      (
        await call("rdra_upsert", {
          items: [
            { kind: "actors", element: { id: "act.customer", name: "顧客" } },
            { kind: "usecases", element: { id: "uc.browse", name: "商品を見る" } },
          ],
        })
      ).isError,
    ).toBe(false);
    expect((await call("rdra_link", { links: [{ relation: "uc.actor", from: "uc.browse", to: "act.customer" }] })).isError).toBe(false);
    const model = (await call("rdra_get_model", { kind: "usecases" })).json();
    expect(model.model.usecases[0].actors).toEqual(["act.customer"]);
    expect(Object.keys(model.model)).toEqual(["usecases"]);
    expect((await call("rdra_query", { sql: "SELECT to_id FROM relations WHERE from_id = 'uc.browse'" })).json()).toEqual([
      { to_id: "act.customer" },
    ]);
    const issues = (await call("rdra_validate")).json().issues.map((i: { code: string }) => i.code);
    expect(issues).toContain("usecase-without-io");
  });

  it("returns errors for invalid edits and bad SQL", async () => {
    const { call } = await connect(await makeRepo());
    const bad = await call("rdra_link", { links: [{ relation: "uc.actor", from: "uc.none", to: "act.none" }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("invalid-operation");
    expect((await call("rdra_query", { sql: "DELETE FROM elements" })).isError).toBe(true);
  });

  it("deletes with cascade and reports removed relations", async () => {
    const { call } = await connect(await makeRepo(rdraFiles()));
    const res = (await call("rdra_delete", { ids: ["scr.cart"] })).json();
    expect(res.removedRelations).toEqual([{ from: "uc.place-order", to: "scr.cart", kind: "uc.screen", attrs: {} }]);
  });

  it("diffs against the base commit", async () => {
    const repo = await makeRepo(rdraFiles());
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    run(repo, "git", ["config", "branch.20260925-120000-demo.geass-base-commit", run(repo, "git", ["rev-parse", "HEAD"]).trim()]);
    const { call } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "screens", element: { id: "scr.top", name: "トップ" } }] });
    const diff = (await call("rdra_diff")).json();
    expect(diff.changes.map((c: { id: string; type: string }) => `${c.type}:${c.id}`)).toEqual(["added:scr.top"]);
  });

  it("refuses to request a review outside a feature or with errors", async () => {
    const outside = await connect(await makeRepo(rdraFiles()));
    expect((await outside.call("rdra_request_review")).isError).toBe(true);

    const repo = await makeRepo({ ...rdraFiles(), [`${RDRA_DIR}/screens.yaml`]: "[]\n" });
    const inside = await connect(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/001-demo" });
    const res = await inside.call("rdra_request_review");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("scr.cart");
  });

  it("requests a review and reports its status", async () => {
    const repo = await makeRepo(rdraFiles());
    const { call } = await connect(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/001-demo" });
    const res = (await call("rdra_request_review")).json();
    expect(res).toMatchObject({ status: "pending", url: null });
    const record = JSON.parse(await readFile(join(repo, "specs/001-demo", REVIEW_FILE), "utf8"));
    expect(record.status).toBe("pending");
    expect((await call("rdra_review_status")).json()).toMatchObject({ status: "pending", approval: "pending", lastRound: null });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/mcp.test.ts`
Expected: FAIL（`../src/mcp.js` が見つからない）

- [ ] **Step 3: 実装する**

`rdra-server/src/version.ts`:

```ts
export const SERVER_VERSION = "0.11.0";
```

`rdra-server/src/mcp.ts`:

```ts
import { join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { diffModels } from "./diff.js";
import { resolveFeatureDir } from "./feature.js";
import { readModelFilesAt, resolveBaseCommit } from "./git.js";
import { ModelParseError, parseModel } from "./model/io.js";
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
      const base = await resolveBaseCommit(store.repoRoot);
      if (!base) return json({ base: null, changes: [], note: "比較対象の分岐点コミットが見つからないため、差分は計算できません" });
      try {
        const baseModel = parseModel(await readModelFilesAt(store.repoRoot, base));
        return json({ base, changes: diffModels(baseModel, store.model) });
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点 ${base} の RDRA を読めません: ${e.message}`);
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

- [ ] **Step 4: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/mcp.test.ts && npx tsc -p .`
Expected: PASS（7 件）、tsc はエラーなし

- [ ] **Step 5: コミットする**

```bash
git add rdra-server/src/version.ts rdra-server/src/mcp.ts rdra-server/test/mcp.test.ts
git commit -m "Add RDRA MCP tools"
```

---

### Task 12: ゲート用 CLI（check-approval / wait-review / hash）

**Files:**
- Create: `rdra-server/src/node-version.ts`
- Create: `rdra-server/src/cli.ts`
- Test: `rdra-server/test/cli.test.ts`

**Interfaces:**
- Consumes: `parseModel`, `readModelFiles`, `ModelParseError`（Task 2）、`modelHash`（Task 3）、`diffModels`（Task 5）、`readModelFilesAt`, `lastCommitTouching`（Task 6）、`readReview`, `approvalState`, `REVIEW_FILE`（Task 10）
- Produces:
  - `nodeVersionError(version: string): string | null`
  - `interface CliIo { out: (s: string) => void; err: (s: string) => void; sleep?: (ms: number) => Promise<void> }`
  - `runCli(argv: string[], io?: CliIo): Promise<number>`（終了コードを返す。`process.exit` は呼ばない）
  - コマンド:
    - `check-approval --repo <root> --feature-dir <dir>` → 標準出力に JSON `{ state, message, changed? }`。終了コード: 承認済み 0、未承認・待機中・差し戻し・承認後の変更 1、YAML エラー 3。
    - `wait-review --repo <root> --feature-dir <dir> [--interval-ms 1000] [--timeout-sec 0]` → 開始時点で pending でなければ終了コード 2。承認か差し戻しになった時点で JSON `{ status, lastRound }` を出して 0。タイムアウトは 124（0 は無期限）。
    - `hash --repo <root>` → ハッシュを出して 0。
    - 不明なコマンドや引数不足は使い方を標準エラーに出して 64。

`check-approval` の `message` は次の文言（ゲートがそのまま利用者に見せる）:

| state | message |
|---|---|
| `none` | `RDRA のレビューがまだ依頼されていません。/rdra でモデルを作成し、レビューを完了してください。` |
| `pending` | `RDRA のレビューが承認待ちです。レビュー画面で承認してください。` |
| `rejected` | `RDRA が差し戻されています。/rdra でコメントに対応し、再度レビューを依頼してください。` |
| `stale` | `承認後に RDRA が変更されました。/rdra で再レビューを受けてください。` |
| `approved` | `RDRA は承認済みです。` |
| `error` | `RDRA の YAML を読めません: <詳細>` |

`stale` のときの `changed` は、レビュー記録ファイルを最後に変更したコミット時点の `docs/rdra` と現在のモデルの差分（`"<type> <id>"` の配列）。そのコミットがなければ省略する。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/cli.test.ts`:

```ts
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runCli, type CliIo } from "../src/cli.js";
import { modelHash } from "../src/model/hash.js";
import { RDRA_DIR } from "../src/model/io.js";
import { nodeVersionError } from "../src/node-version.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { sampleFiles, sampleModel } from "./fixtures.js";
import { makeRepo, run } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const T = "2026-09-25T10:00:00+09:00";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  const io: CliIo = { out: (s) => void out.push(s), err: (s) => void err.push(s), sleep: async () => {} };
  return { io, out, err };
}

async function check(repo: string, featureDir: string) {
  const c = capture();
  const code = await runCli(["check-approval", "--repo", repo, "--feature-dir", featureDir], c.io);
  return { code, result: JSON.parse(c.out.join("")) };
}

describe("nodeVersionError", () => {
  it("accepts 22.13 and later", () => {
    expect(nodeVersionError("22.13.0")).toBeNull();
    expect(nodeVersionError("24.4.0")).toBeNull();
    expect(nodeVersionError("22.12.1")).toContain("Node 22.13 以上");
    expect(nodeVersionError("20.19.0")).toContain("現在: 20.19.0");
  });
});

describe("check-approval", () => {
  it("reports none, pending, rejected, approved and stale", async () => {
    const repo = await makeRepo(rdraFiles());
    const fd = join(repo, "specs/001-demo");
    expect(await check(repo, fd)).toMatchObject({ code: 1, result: { state: "none" } });

    let rec = requestReview(emptyReview(), { now: T, baseCommit: null });
    await writeReview(fd, rec);
    expect(await check(repo, fd)).toMatchObject({ code: 1, result: { state: "pending" } });

    await writeReview(fd, decide(rec, { decision: "rejected", comments: [{ target: null, text: "x" }], hash: "h", now: T }));
    expect(await check(repo, fd)).toMatchObject({ code: 1, result: { state: "rejected" } });

    rec = decide(rec, { decision: "approved", comments: [], hash: modelHash(sampleModel()), now: T });
    await writeReview(fd, rec);
    expect(await check(repo, fd)).toMatchObject({ code: 0, result: { state: "approved" } });

    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "approve"]);
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "- id: scr.cart\n  name: カート画面\n");
    const stale = await check(repo, fd);
    expect(stale).toMatchObject({ code: 1, result: { state: "stale", changed: ["modified scr.cart"] } });
    expect(stale.result.message).toContain("再レビュー");
  });

  it("exits 3 on YAML errors", async () => {
    const repo = await makeRepo({ [`${RDRA_DIR}/actors.yaml`]: "- id: [\n" });
    expect(await check(repo, join(repo, "specs/001-demo"))).toMatchObject({ code: 3, result: { state: "error" } });
  });
});

describe("wait-review", () => {
  it("exits 2 when nothing is pending", async () => {
    const repo = await makeRepo();
    const c = capture();
    expect(await runCli(["wait-review", "--repo", repo, "--feature-dir", join(repo, "specs/x")], c.io)).toBe(2);
  });

  it("returns when the review is decided", async () => {
    const repo = await makeRepo();
    const fd = join(repo, "specs/001-demo");
    const pending = requestReview(emptyReview(), { now: T, baseCommit: null });
    await writeReview(fd, pending);
    let polls = 0;
    const c = capture();
    c.io.sleep = async () => {
      polls += 1;
      if (polls === 3) {
        await writeReview(fd, decide(pending, { decision: "rejected", comments: [{ target: "uc.a", text: "直して" }], hash: "h", now: T }));
      }
    };
    expect(await runCli(["wait-review", "--repo", repo, "--feature-dir", fd], c.io)).toBe(0);
    expect(JSON.parse(c.out.join(""))).toMatchObject({ status: "rejected", lastRound: { comments: [{ text: "直して" }] } });
  });

  it("times out with 124", async () => {
    const repo = await makeRepo();
    const fd = join(repo, "specs/001-demo");
    await writeReview(fd, requestReview(emptyReview(), { now: T, baseCommit: null }));
    const c = capture();
    c.io.sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    expect(await runCli(["wait-review", "--repo", repo, "--feature-dir", fd, "--interval-ms", "10", "--timeout-sec", "0.05"], c.io)).toBe(124);
  });
});

describe("usage", () => {
  it("prints the hash and rejects unknown commands", async () => {
    const repo = await makeRepo(rdraFiles());
    const c = capture();
    expect(await runCli(["hash", "--repo", repo], c.io)).toBe(0);
    expect(c.out.join("").trim()).toBe(modelHash(sampleModel()));
    expect(await runCli(["nope"], capture().io)).toBe(64);
    expect(await runCli(["check-approval", "--repo", repo], capture().io)).toBe(64);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/cli.test.ts`
Expected: FAIL（モジュールが見つからない）

- [ ] **Step 3: Node バージョンチェックを実装する**

`rdra-server/src/node-version.ts`:

```ts
export function nodeVersionError(version: string): string | null {
  const [major, minor] = version.split(".").map((n) => Number.parseInt(n, 10));
  const ok = major > 22 || (major === 22 && minor >= 13);
  return ok ? null : `geass rdra-server には Node 22.13 以上が必要です（現在: ${version}）`;
}
```

- [ ] **Step 4: CLI を実装する**

`rdra-server/src/cli.ts`:

```ts
import { join, relative } from "node:path";
import { parseArgs } from "node:util";
import { diffModels } from "./diff.js";
import { lastCommitTouching, readModelFilesAt } from "./git.js";
import { modelHash } from "./model/hash.js";
import { ModelParseError, parseModel, readModelFiles } from "./model/io.js";
import type { Model } from "./model/kinds.js";
import { REVIEW_FILE, approvalState, readReview, type ReviewRecord } from "./review.js";

export interface CliIo {
  out: (s: string) => void;
  err: (s: string) => void;
  sleep?: (ms: number) => Promise<void>;
}

const defaultIo: CliIo = {
  out: (s) => void process.stdout.write(s),
  err: (s) => void process.stderr.write(s),
};

const USAGE = [
  "usage:",
  "  cli.js check-approval --repo <root> --feature-dir <dir>",
  "  cli.js wait-review --repo <root> --feature-dir <dir> [--interval-ms 1000] [--timeout-sec 0]",
  "  cli.js hash --repo <root>",
  "",
].join("\n");

const MESSAGES = {
  none: "RDRA のレビューがまだ依頼されていません。/rdra でモデルを作成し、レビューを完了してください。",
  pending: "RDRA のレビューが承認待ちです。レビュー画面で承認してください。",
  rejected: "RDRA が差し戻されています。/rdra でコメントに対応し、再度レビューを依頼してください。",
  stale: "承認後に RDRA が変更されました。/rdra で再レビューを受けてください。",
  approved: "RDRA は承認済みです。",
} as const;

async function loadModel(repo: string): Promise<Model> {
  return parseModel(await readModelFiles(repo));
}

async function changedSinceApproval(repo: string, featureDir: string, current: Model): Promise<string[] | undefined> {
  const commit = await lastCommitTouching(repo, relative(repo, join(featureDir, REVIEW_FILE)));
  if (!commit) return undefined;
  try {
    const approved = parseModel(await readModelFilesAt(repo, commit));
    return diffModels(approved, current).map((c) => `${c.type} ${c.id}`);
  } catch {
    return undefined;
  }
}

async function checkApproval(repo: string, featureDir: string, io: CliIo): Promise<number> {
  let model: Model;
  try {
    model = await loadModel(repo);
  } catch (e) {
    if (!(e instanceof ModelParseError)) throw e;
    io.out(JSON.stringify({ state: "error", message: `RDRA の YAML を読めません: ${e.message}` }) + "\n");
    return 3;
  }
  const state = approvalState(await readReview(featureDir), modelHash(model));
  const result: { state: string; message: string; changed?: string[] } = { state: state.state, message: MESSAGES[state.state] };
  if (state.state === "stale") {
    const changed = await changedSinceApproval(repo, featureDir, model);
    if (changed) result.changed = changed;
  }
  io.out(JSON.stringify(result) + "\n");
  return state.state === "approved" ? 0 : 1;
}

async function safeRead(featureDir: string): Promise<ReviewRecord | null> {
  try {
    return await readReview(featureDir);
  } catch {
    return null;
  }
}

async function waitReview(featureDir: string, intervalMs: number, timeoutSec: number, io: CliIo): Promise<number> {
  const sleep = io.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const initial = await readReview(featureDir);
  if (initial.status !== "pending") {
    io.out(JSON.stringify({ status: initial.status, message: "レビュー待ちではありません" }) + "\n");
    return 2;
  }
  const deadline = timeoutSec > 0 ? Date.now() + timeoutSec * 1000 : Number.POSITIVE_INFINITY;
  for (;;) {
    await sleep(intervalMs);
    const record = await safeRead(featureDir);
    if (record && record.status !== "pending") {
      io.out(JSON.stringify({ status: record.status, lastRound: record.rounds.at(-1) ?? null }) + "\n");
      return 0;
    }
    if (Date.now() >= deadline) {
      io.out(JSON.stringify({ status: "pending", timeout: true }) + "\n");
      return 124;
    }
  }
}

export async function runCli(argv: string[], io: CliIo = defaultIo): Promise<number> {
  const [command, ...rest] = argv;
  let values: Record<string, string | undefined>;
  try {
    ({ values } = parseArgs({
      args: rest,
      options: {
        repo: { type: "string" },
        "feature-dir": { type: "string" },
        "interval-ms": { type: "string" },
        "timeout-sec": { type: "string" },
      },
      strict: true,
    }) as { values: Record<string, string | undefined> });
  } catch (e) {
    io.err(`${(e as Error).message}\n${USAGE}`);
    return 64;
  }
  const repo = values.repo;
  const featureDir = values["feature-dir"];

  if (command === "check-approval" && repo && featureDir) return checkApproval(repo, featureDir, io);
  if (command === "wait-review" && repo && featureDir) {
    return waitReview(featureDir, Number(values["interval-ms"] ?? "1000"), Number(values["timeout-sec"] ?? "0"), io);
  }
  if (command === "hash" && repo) {
    io.out(modelHash(await loadModel(repo)) + "\n");
    return 0;
  }
  io.err(USAGE);
  return 64;
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `cd rdra-server && npx vitest run test/cli.test.ts && npx tsc -p .`
Expected: PASS（7 件）、tsc はエラーなし

- [ ] **Step 6: コミットする**

```bash
git add rdra-server/src/node-version.ts rdra-server/src/cli.ts rdra-server/test/cli.test.ts
git commit -m "Add check-approval and wait-review CLI for the gate"
```

---

### Task 13: サーバーのエントリ、ビルド、plugin への登録

**Files:**
- Create: `rdra-server/src/server.ts`
- Create: `rdra-server/src/bin/server.ts`
- Create: `rdra-server/src/bin/cli.ts`
- Create: `rdra-server/build.mjs`
- Create: `.mcp.json`
- Create: `rdra-server/dist/server.js`, `rdra-server/dist/cli.js`（ビルド成果物）
- Test: `rdra-server/test/dist.test.ts`

**Interfaces:**
- Consumes: `repoRootOf`（Task 6）、`QueryIndex`（Task 7）、`RdraStore`（Task 9）、`createMcpServer`（Task 11）、`runCli`, `nodeVersionError`（Task 12）
- Produces:
  - `startServer(): Promise<void>`（`src/server.ts`）。対象ディレクトリは `CLAUDE_PROJECT_DIR`、なければ `process.cwd()`。git リポジトリでなければそのディレクトリをそのまま使う。
  - `dist/server.js`（MCP stdio サーバー）、`dist/cli.js`（CLI）
  - plugin の MCP サーバー名 `rdra`。Claude Code 上のツール名は `mcp__plugin_geass_rdra__rdra_get_model` のようになる。

- [ ] **Step 1: 失敗するテストを書く**

`rdra-server/test/dist.test.ts`:

```ts
import { execFileSync, spawnSync } from "node:child_process";
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
  it("produces server.js and cli.js", () => {
    expect(existsSync(dist("server.js"))).toBe(true);
    expect(existsSync(dist("cli.js"))).toBe(true);
  });

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

- [ ] **Step 2: テストが失敗することを確認する**

Run: `cd rdra-server && npx vitest run test/dist.test.ts`
Expected: FAIL（`build.mjs` がない）

- [ ] **Step 3: サーバーとエントリを実装する**

`rdra-server/src/server.ts`:

```ts
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repoRootOf } from "./git.js";
import { createMcpServer } from "./mcp.js";
import { QueryIndex } from "./query.js";
import { RdraStore } from "./store.js";

export async function startServer(): Promise<void> {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const repoRoot = (await repoRootOf(cwd)) ?? cwd;
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const server = createMcpServer({ store, index: new QueryIndex(), reviewUrl: () => null });
  await server.connect(new StdioServerTransport());
}
```

`rdra-server/src/bin/server.ts`:

```ts
import { nodeVersionError } from "../node-version.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  process.stderr.write(versionError + "\n");
  process.exit(1);
}
const { startServer } = await import("../server.js");
await startServer();
```

`rdra-server/src/bin/cli.ts`:

```ts
import { nodeVersionError } from "../node-version.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  process.stdout.write(JSON.stringify({ state: "error", message: versionError }) + "\n");
  process.exit(3);
}
const { runCli } = await import("../cli.js");
process.exitCode = await runCli(process.argv.slice(2));
```

- [ ] **Step 4: ビルドスクリプトを作る**

`rdra-server/build.mjs`:

```js
import { build } from "esbuild";

await build({
  entryPoints: { server: "src/bin/server.ts", cli: "src/bin/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
```

- [ ] **Step 5: plugin に MCP サーバーを登録する**

`.mcp.json`（リポジトリ直下）:

```json
{
  "mcpServers": {
    "rdra": {
      "command": "node",
      "args": ["${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/server.js"]
    }
  }
}
```

- [ ] **Step 6: テストを含む全体を確認する**

Run: `cd rdra-server && npx vitest run && npx tsc -p .`
Expected: すべての test ファイルが PASS、tsc はエラーなし。`dist/server.js` と `dist/cli.js` ができている。

- [ ] **Step 7: 実際の Claude Code から見えることを手で確認する**

Run: `claude --plugin-dir /path/to/geass mcp list`（または `/mcp` で確認）
Expected: `plugin:geass:rdra` が connected と表示される。表示されない場合は `claude --debug` の出力で起動エラーを確認する。

- [ ] **Step 8: コミットする**

```bash
git add .mcp.json rdra-server/build.mjs rdra-server/src/server.ts rdra-server/src/bin rdra-server/dist rdra-server/test/dist.test.ts
git commit -m "Bundle rdra-server and register it as the plugin's MCP server"
```

---

## 完了条件

- `cd rdra-server && npx vitest run && npx tsc -p .` がすべて通る。
- `dist/` がコミットされており、`node rdra-server/dist/cli.js hash --repo .` が動く。
- Claude Code から `rdra_*` ツールが見え、`rdra_upsert` で `docs/rdra/*.yaml` が作られる。
