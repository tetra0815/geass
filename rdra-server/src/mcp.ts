import { existsSync } from "node:fs";
import { join, relative } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ElementChange } from "./diff.js";
import { NO_BASE_MESSAGE, diffAgainstBase } from "./base-diff.js";
import { designRequired } from "./approval.js";
import { isInvalidFeature, resolveFeature, stageReviewFile } from "./feature.js";
import { rdraHash } from "./model/hash.js";
import { ModelParseError } from "./model/io.js";
import { KIND_KEYS } from "./model/kinds.js";
import { RELATION_KINDS } from "./model/relations.js";
import type { Operation } from "./operations.js";
import type { QueryIndex } from "./query.js";
import { approvalState, readReview, requestReview, writeReview } from "./review.js";
import type { RdraStore } from "./store.js";
import { hasErrors, validate, validateChanges, validateDesignChanges } from "./validate.js";
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

  /** This feature's changes, or null on a feature branch whose diff base cannot be resolved. */
  const featureChanges = async (): Promise<ElementChange[] | null> => {
    const diff = await diffAgainstBase(store.repoRoot, store.model);
    if (!diff.base) {
      const feature = await resolveFeature(store.repoRoot);
      if (feature && !isInvalidFeature(feature)) return null;
    }
    return diff.changes;
  };
  const fileExists = (path: string) => existsSync(join(store.repoRoot, path));

  server.registerTool(
    "rdra_get_model",
    {
      description: "RDRA モデル（docs/rdra）と設計モデル（docs/design）を取得する。kind を指定するとその種別だけを返す。",
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
        "RDRA モデルに読み取り専用の SQL で問い合わせる。テーブル: elements(id, kind, name, description, data), relations(from_id, to_id, kind, attrs), state_nodes(model_id, state_id, name), state_transitions(model_id, from_state, to_state, ref), acceptance(usecase_id, ac_id, ref, given_text, when_text, then_text)。ビュー: principle_scope(principle_id, target_id)、種別ごとの actors, external_systems, bucs, usecases, screens, events, information, state_models, principles、components, tables, decisions。",
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
    {
      description:
        "RDRA と設計のモデルの整合性チェック。issues の error はレビュー依頼を妨げ、warning は妨げない。featureIssues はこの feature の RDRA の差分の検査（RDRA レビューを妨げる）、designFeatureIssues は設計がこの feature の RDRA の差分を実現しているかの検査（error が設計レビューを妨げる）。",
      inputSchema: {},
    },
    async () => {
      try {
        const changes = await featureChanges();
        if (!changes) return fail(`この feature の差分を検査できません: ${NO_BASE_MESSAGE}`);
        return json({
          parseError: store.parseError?.message ?? null,
          issues: validate(store.model, { fileExists }),
          featureIssues: validateChanges(changes),
          designFeatureIssues: validateDesignChanges(store.model, changes),
        });
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点の RDRA を読めません: ${e.message}`);
        throw e;
      }
    },
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
        "要素を追加または更新する（既存 ID なら指定したフィールドだけを上書き）。kind: actors, externalSystems, bucs, usecases, screens, events, information, states, principles（RDRA、docs/rdra）、components, tables, decisions（設計、docs/design）。ID は <接頭辞>.<スラッグ>（act, ext, buc, uc, scr, evt, inf, st, pr, comp, tbl, adr）。principles は category（business/quality/security/engineering/technology）と level（must/should）が必須。usecases の acceptance は [{id, given?, when, then}]。components は type（app/worker/datastore/queue/external）が必須、任意で tech, dependsOn [{ref, label?}], realizes（ext/pr）, holds（inf）, doc。tables は store（datastore の comp）と realizes（inf を 1 つ以上）が必須、任意で states（st）, key, related [{ref, label?}], doc。decisions は status（proposed/accepted/superseded）, context, decision が必須、任意で alternatives, affects（comp/tbl）, basis（pr）, supersededBy（adr）。",
      inputSchema: {
        items: z.array(z.object({ kind: z.enum(KIND_KEYS), element: z.record(z.string(), z.unknown()) })).min(1),
      },
    },
    async ({ items }) => applyTool(items.map((i) => ({ op: "upsert", kind: i.kind, element: i.element }))),
  );

  server.registerTool(
    "rdra_delete",
    { description: "要素を削除する。その要素を参照している関連も同時に外れ、removedRelations に返る。参照元の要素が成り立たなくなる削除（テーブルの置き場所や唯一の実現情報など）は拒否される。", inputSchema: { ids: z.array(z.string()).min(1) } },
    async ({ ids }) => applyTool(ids.map((id) => ({ op: "delete", id }))),
  );

  server.registerTool(
    "rdra_link",
    {
      description:
        "関連を張る。relation は起点の種別で決まる（例: uc.screen は uc -> scr）。uc.information には attrs.access（create/read/update/delete）が必要。uc.transition の to は st.<モデル>:<状態>-><状態>。inf.related には任意で attrs.label。pr.scope は pr -> act/ext/buc/uc/scr/inf/st（原則がかかる要素）。設計: comp.depends（comp -> comp、任意で attrs.label）, comp.realizes（comp -> ext/pr）, comp.holds（comp -> inf）, tbl.store（tbl -> comp）, tbl.realizes（tbl -> inf）, tbl.state（tbl -> st）, tbl.related（tbl -> tbl、任意で attrs.label）, adr.affects（adr -> comp/tbl）, adr.basis（adr -> pr）, adr.superseded-by（adr -> adr）。",
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
        "人間のレビューを依頼する（状態を pending にする）。stage: rdra（既定。RDRA モデル）/ design（設計モデル。RDRA が承認済みで、設計がこの feature の RDRA の変更を実現しているときだけ依頼できる）。エラーが 1 件でもあると依頼できない。承認・差し戻しはレビュー画面で人間だけが行う。",
      inputSchema: { stage: z.enum(["rdra", "design"]).optional() },
    },
    async ({ stage = "rdra" }) => {
      const feature = await resolveFeature(store.repoRoot);
      if (!feature) {
        return fail("feature の外ではレビューを依頼できません。feature/* ブランチ（/feature-start で作った worktree）で実行してください");
      }
      if (isInvalidFeature(feature)) return fail(`レビューを依頼できません: ${feature.reason}`);
      if (store.parseError) return fail(`YAML にエラーがあります: ${store.parseError.message}`);
      const issues = validate(store.model);
      if (hasErrors(issues)) {
        const errors = issues.filter((i) => i.level === "error").map((i) => `- ${i.message}`);
        return fail(`エラーを解消してからレビューを依頼してください:\n${errors.join("\n")}`);
      }
      let changes;
      try {
        changes = await featureChanges();
      } catch (e) {
        if (e instanceof ModelParseError) return fail(`分岐点のモデルを読めません: ${e.message}`);
        throw e;
      }
      if (stage === "rdra") {
        if (!changes) return fail(`受け入れ条件を検査できないためレビューを依頼できません: ${NO_BASE_MESSAGE}`);
        const blockers = validateChanges(changes);
        if (blockers.length > 0) {
          return fail(`受け入れ条件が足りないためレビューを依頼できません:\n${blockers.map((i) => `- ${i.message}`).join("\n")}`);
        }
      } else {
        const rdra = approvalState(await readReview(feature.reviewFile), rdraHash(store.model)).state;
        if (rdra !== "approved") {
          return fail("RDRA が承認されていないため、設計のレビューを依頼できません。先に /rdra で RDRA の承認を受けてください");
        }
        if (!changes) return fail(`設計の網羅を検査できないためレビューを依頼できません: ${NO_BASE_MESSAGE}`);
        const gaps = validateDesignChanges(store.model, changes).filter((i) => i.level === "error");
        if (gaps.length > 0) {
          return fail(`設計がこの feature の RDRA の変更を実現していないため、レビューを依頼できません:\n${gaps.map((i) => `- ${i.message}`).join("\n")}`);
        }
      }
      const file = stageReviewFile(feature, stage);
      // Read-modify-write under the store lock so it cannot race a decision
      // arriving from the review UI.
      const record = await store.exclusive(async () => {
        const next = requestReview(await readReview(file), { now: now() });
        await writeReview(file, next);
        return next;
      });
      deps.onReviewChange?.();
      return json({ stage, status: record.status, url: deps.reviewUrl(), reviewFile: relative(store.repoRoot, file) });
    },
  );

  server.registerTool(
    "rdra_review_status",
    {
      description:
        "RDRA と設計のレビューの状態（none / pending / approved / rejected）と、最後の判断のコメント。approval が stale なら承認後にモデルが変更されている。design.required が false なら、この feature は設計の承認なしで計画に進める。",
      inputSchema: {},
    },
    async () => {
      const feature = await resolveFeature(store.repoRoot);
      if (!feature || isInvalidFeature(feature)) {
        const note = feature ? feature.reason : "feature の外です";
        const design = { status: "none", approval: "none", lastRound: null, required: null };
        return json({ status: "none", approval: "none", lastRound: null, url: deps.reviewUrl(), design, note });
      }
      const record = await readReview(feature.reviewFile);
      const designRecord = await readReview(feature.designReviewFile);
      let required: boolean | null = null;
      try {
        const changes = await featureChanges();
        required = changes ? designRequired(store.model, changes) : null;
      } catch (e) {
        if (!(e instanceof ModelParseError)) throw e;
      }
      return json({
        status: record.status,
        approval: approvalState(record, rdraHash(store.model)).state,
        lastRound: record.rounds.at(-1) ?? null,
        url: deps.reviewUrl(),
        design: {
          status: designRecord.status,
          approval: approvalState(designRecord, store.version).state,
          lastRound: designRecord.rounds.at(-1) ?? null,
          required,
        },
      });
    },
  );

  return server;
}
