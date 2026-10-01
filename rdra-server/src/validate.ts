import type { ElementChange } from "./diff.js";
import { KINDS, type KindKey, type Model, type Usecase } from "./model/kinds.js";
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

export interface ValidateOptions {
  /** Whether a repository-relative path exists; without it, design `doc` paths are not checked. */
  fileExists?: (repoRelativePath: string) => boolean;
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === "error");
}

export function validate(model: Model, opts: ValidateOptions = {}): Issue[] {
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
    const acIds = new Set<string>();
    for (const ac of uc.acceptance) {
      if (acIds.has(ac.id)) error("duplicate-acceptance", `${uc.id} の受け入れ条件 ${ac.id} が重複しています`, uc.id);
      acIds.add(ac.id);
      if (!ac.when.trim() || !ac.then.trim()) {
        error("empty-acceptance", `${uc.id} の受け入れ条件 ${ac.id} の when / then が空です`, uc.id);
      }
    }
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

  for (const p of model.principles) {
    if (p.level === "must" && !p.description?.trim()) {
      warn("principle-without-description", `${p.id} は MUST ですが、何を満たせば守ったことになるか（説明）がありません`, p.id);
    }
  }

  const related = new Set(relationsOf(model).flatMap((r) => [r.from, r.to]));
  const checkDoc = (id: string, doc: string | undefined) => {
    if (doc && opts.fileExists && !opts.fileExists(doc)) warn("missing-doc", `${id} の doc ${doc} が見つかりません`, id);
  };
  const components = new Map(model.components.map((c) => [c.id, c]));
  for (const c of model.components) {
    if (!related.has(c.id)) warn("isolated-component", `${c.id} はどの要素とも関係していません`, c.id);
    checkDoc(c.id, c.doc);
  }
  for (const t of model.tables) {
    const store = components.get(t.store);
    if (store && store.type !== "datastore") {
      error("table-store-not-datastore", `${t.id} の置き場所 ${t.store} は datastore ではありません（type: ${store.type}）`, t.id);
    }
    for (const id of t.states) {
      const sm = stateModels.get(id);
      if (sm && (!sm.information || !t.realizes.includes(sm.information))) {
        error("table-state-mismatch", `${t.id} の状態 ${id} は、${t.id} が実現する情報の状態モデルではありません`, t.id);
      }
    }
    checkDoc(t.id, t.doc);
  }
  const decisions = new Map(model.decisions.map((d) => [d.id, d]));
  for (const d of model.decisions) {
    if (d.status === "superseded" && !d.supersededBy) {
      error("decision-without-successor", `${d.id} は superseded ですが、後継（supersededBy）がありません`, d.id);
    }
    if (d.supersededBy && decisions.get(d.supersededBy)?.status === "superseded") {
      error("decision-successor-superseded", `${d.id} の後継 ${d.supersededBy} も superseded です。有効な判断を指してください`, d.id);
    }
  }

  return issues;
}

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

const liveIds = (changes: ElementChange[], kind: KindKey) =>
  changes.filter((c) => c.kind === kind && c.type !== "removed").map((c) => c.id);

/** Whether the design realizes what this feature added to or changed in the RDRA model. */
export function validateDesignChanges(model: Model, changes: ElementChange[]): Issue[] {
  const issues: Issue[] = [];
  const error = (code: string, message: string, elementId: string) => issues.push({ level: "error", code, message, elementId });
  const inTables = new Set(model.tables.flatMap((t) => t.realizes));
  const held = new Set(model.components.flatMap((c) => c.holds));
  const realizedByComponents = new Set(model.components.flatMap((c) => c.realizes));

  for (const id of liveIds(changes, "externalSystems")) {
    if (!realizedByComponents.has(id)) error("external-system-not-realized", `${id} と連携するコンポーネント（realizes）がありません`, id);
  }
  for (const id of liveIds(changes, "information")) {
    if (!inTables.has(id) && !held.has(id)) {
      error("information-not-realized", `${id} を保存するテーブルも、保持するコンポーネント（holds）もありません`, id);
    }
  }
  for (const id of liveIds(changes, "states")) {
    const info = model.states.find((s) => s.id === id)?.information;
    if (!info) continue;
    const tables = model.tables.filter((t) => t.realizes.includes(info));
    if (tables.length > 0 && !tables.some((t) => t.states.includes(id))) {
      error("state-not-stored", `${id} を状態として持つテーブルがありません（${tables.map((t) => t.id).join(", ")} の states に加えてください）`, id);
    }
  }
  const grounded = new Set([...realizedByComponents, ...model.decisions.flatMap((d) => d.basis)]);
  for (const id of liveIds(changes, "principles")) {
    const p = model.principles.find((x) => x.id === id);
    if (p && p.category === "technology" && p.level === "must" && !grounded.has(id)) {
      issues.push({
        level: "warning",
        code: "technology-principle-not-realized",
        message: `${id} を実現するコンポーネント（realizes）も、根拠にする設計判断（basis）もありません`,
        elementId: id,
      });
    }
  }
  return issues;
}
