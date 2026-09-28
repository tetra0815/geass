import { relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { diffAgainstBase } from "./base-diff.js";
import { resolveFeature } from "./feature.js";
import { ModelParseError } from "./model/io.js";
import { KIND_KEYS } from "./model/kinds.js";
import { RELATION_KINDS } from "./model/relations.js";
import type { Operation } from "./operations.js";
import type { QueryIndex } from "./query.js";
import { approvalState, readReview, requestReview, writeReview } from "./review.js";
import type { RdraStore } from "./store.js";
import { hasErrors, validate } from "./validate.js";
import { SERVER_VERSION } from "./version.js";

export interface McpDeps {
  store: RdraStore;
  index: QueryIndex;
  reviewUrl: () => string | null;
  now?: () => string;
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
        "要素を追加または更新する（既存 ID なら指定したフィールドだけを上書き）。kind: actors, externalSystems, bucs, usecases, screens, events, information, states, principles。ID は <接頭辞>.<スラッグ>（act, ext, buc, uc, scr, evt, inf, st, pr）。principles は category（business/quality/security/engineering/technology）と level（must/should）が必須。usecases の acceptance は [{id, given?, when, then}]。",
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
        "関連を張る。relation は起点の種別で決まる（例: uc.screen は uc -> scr）。uc.information には attrs.access（create/read/update/delete）が必要。uc.transition の to は st.<モデル>:<状態>-><状態>。inf.related には任意で attrs.label。pr.scope は pr -> act/ext/buc/uc/scr/inf/st（原則がかかる要素）。",
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
  );

  server.registerTool(
    "rdra_review_status",
    { description: "レビューの状態（none / pending / approved / rejected）と、最後の判断のコメント。approval が stale なら承認後にモデルが変更されている。", inputSchema: {} },
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
  );

  return server;
}
