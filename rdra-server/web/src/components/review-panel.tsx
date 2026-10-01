import { useState } from "react";
import type { ReviewComment } from "../../../src/review.js";
import type { AppState } from "../api.js";
import { activeStage } from "../review-stage.js";

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

const DESIGN_NOT_REQUIRED = "不要（この feature に設計の変更なし）";

export function ReviewPanel(props: Props) {
  const { state, drafts, commentTarget, busy } = props;
  const [text, setText] = useState("");
  const errors = state.issues.filter((i) => i.level === "error");
  const warnings = state.issues.filter((i) => i.level === "warning");
  const stage = activeStage(state);
  const pending = stage !== null;
  const canApprove = pending && errors.length === 0 && !state.parseError && !busy;
  const canReject = pending && drafts.length > 0 && !busy;
  const lastRound = (stage === "design" ? state.design.review : state.review)?.rounds.at(-1);
  const designLabel = !state.design.required && state.design.approval !== "pending" && state.design.approval !== "approved" ? DESIGN_NOT_REQUIRED : STATUS_LABELS[state.design.approval];

  const add = () => {
    if (text.trim() === "") return;
    props.onAddDraft({ target: commentTarget, text: text.trim() });
    setText("");
  };

  return (
    <section className="review">
      <h3>レビュー</h3>
      <p className="stages">
        RDRA:{" "}
        <span className={`status status-${state.approval}`} data-stage="rdra">
          {STATUS_LABELS[state.approval]}
        </span>
        <br />
        設計:{" "}
        <span className={`status status-${state.design.approval}`} data-stage="design">
          {designLabel}
        </span>
      </p>
      {stage && <p className="hint">{stage === "rdra" ? "RDRA" : "設計"}のレビュー中です。承認・差し戻しはこのレビューに記録されます。</p>}
      {!state.feature && <p className="hint">feature の外で開いているため、承認・差し戻しはできません。</p>}

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
