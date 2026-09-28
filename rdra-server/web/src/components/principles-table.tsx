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
