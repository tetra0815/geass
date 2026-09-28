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

  return issues;
}
