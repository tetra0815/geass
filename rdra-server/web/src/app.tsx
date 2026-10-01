import { useCallback, useEffect, useMemo, useState } from "react";
import { VIEW_KEYS, VIEW_LABELS, type Positions, type ViewKey } from "../../src/model/view-keys.js";
import type { Operation } from "../../src/operations.js";
import type { ReviewComment } from "../../src/review.js";
import { api, subscribe, type AppState, type DiffState } from "./api.js";
import { autoLayout, type LayoutResult } from "./auto-layout.js";
import { DiagramCanvas, type Selection } from "./components/diagram-canvas.js";
import { DecisionsTable } from "./components/decisions-table.js";
import { Inspector } from "./components/inspector.js";
import { Palette } from "./components/palette.js";
import { PrinciplesTable } from "./components/principles-table.js";
import { ReviewPanel } from "./components/review-panel.js";
import { activeStage } from "./review-stage.js";
import { inferLink, inferTransition } from "./infer.js";
import { projectView, viewForId } from "./views.js";

export function App() {
  const [state, setState] = useState<AppState | null>(null);
  const [diff, setDiff] = useState<DiffState | null>(null);
  const [view, setView] = useState<ViewKey>("usecase-composite");
  const [page, setPage] = useState<"diagram" | "principles" | "decisions">("diagram");
  const [focus, setFocus] = useState<string | null>(null);
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
      // Hold the review decision until the edited model is loaded, or it
      // would be posted with the version from before this edit.
      setBusy(true);
      try {
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
      } finally {
        setBusy(false);
      }
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
    const stage = activeStage(state);
    if (!stage) return;
    setBusy(true);
    try {
      const res = await api.decide(decision, drafts, state.version, stage);
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
    if (id.startsWith("adr.")) {
      setPage("decisions");
      setFocus(id);
      return;
    }
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

  if (!state) return <div className="loading">読み込み中…</div>;
  const readOnly = state.parseError !== null;

  return (
    <div className="app">
      <header>
        <h1>RDRA・設計レビュー</h1>
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
          <button
            className={page === "decisions" ? "active" : ""}
            onClick={() => {
              setPage("decisions");
              setFocus("");
            }}
          >
            設計判断
          </button>
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
        ) : page === "decisions" ? (
          <div className="canvas">
            <DecisionsTable
              model={state.model}
              changes={diffMode && diff ? diff.changes : []}
              focus={focus || null}
              onJump={jump}
              onComment={setCommentTarget}
            />
          </div>
        ) : (
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
                onOpenPrinciples={openPrinciples}
              />
            ) : (
              <div className="loading">配置を計算中…</div>
            )}
          </div>
        )}
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
