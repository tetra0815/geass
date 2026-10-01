import type { ElementChange } from "../../../src/diff.js";
import type { Decision, Model } from "../../../src/model/kinds.js";

interface Props {
  model: Model;
  changes: ElementChange[];
  focus: string | null;
  onJump: (id: string) => void;
  onComment: (id: string) => void;
}

const STATUS_LABELS: Record<Decision["status"], string> = {
  proposed: "提案",
  accepted: "採用",
  superseded: "置き換え済み",
};

function Links({ ids, onJump }: { ids: string[]; onJump: (id: string) => void }) {
  return (
    <>
      {ids.map((id) => (
        <button key={id} className="link" onClick={() => onJump(id)}>
          {id}
        </button>
      ))}
    </>
  );
}

export function DecisionsTable({ model, changes, focus, onJump, onComment }: Props) {
  const statusOf = new Map(changes.map((c) => [c.id, c.type]));
  const removed = changes.filter((c) => c.kind === "decisions" && c.type === "removed");
  return (
    <div className="principles-page">
      <h2>設計判断</h2>
      <p className="hint">設計判断は /design が編集します。ここでは確認とコメントができます。</p>
      {model.decisions.length === 0 && removed.length === 0 ? (
        <p className="hint">設計判断はまだありません。</p>
      ) : (
        <table className="principles">
          <thead>
            <tr>
              <th>ID</th>
              <th>名前</th>
              <th>状態</th>
              <th>決定</th>
              <th>影響</th>
              <th>根拠</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {model.decisions.map((d) => (
              <tr key={d.id} className={[focus === d.id ? "focused" : "", statusOf.has(d.id) ? `rdra-${statusOf.get(d.id)}` : ""].join(" ")}>
                <td>
                  <code>{d.id}</code>
                </td>
                <td>{d.name}</td>
                <td>
                  {STATUS_LABELS[d.status]}
                  {d.supersededBy && (
                    <>
                      {" → "}
                      <Links ids={[d.supersededBy]} onJump={onJump} />
                    </>
                  )}
                </td>
                <td>
                  {d.decision}
                  {d.alternatives.length > 0 && (
                    <ul className="alternatives">
                      {d.alternatives.map((a) => (
                        <li key={a}>{a}</li>
                      ))}
                    </ul>
                  )}
                </td>
                <td>
                  <Links ids={d.affects} onJump={onJump} />
                </td>
                <td>
                  <Links ids={d.basis} onJump={onJump} />
                </td>
                <td>
                  <button onClick={() => onComment(d.id)}>コメント</button>
                </td>
              </tr>
            ))}
            {removed.map((c) => (
              <tr key={c.id} className="rdra-removed">
                <td>
                  <code>{c.id}</code>
                </td>
                <td>{c.before?.name}</td>
                <td colSpan={5}>削除</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
