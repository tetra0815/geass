import { useState } from "react";
import {
  AccessSchema,
  SLUG,
  emptyModel,
  findElement,
  kindOfId,
  type AnyElement,
  type Acceptance,
  type Model,
  type StateModel,
  type Usecase,
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
      {kind.key === "usecases" && <AcceptanceEditor usecase={element as Usecase} disabled={disabled} onApply={onApply} />}
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

function AcceptanceEditor({ usecase, disabled, onApply }: { usecase: Usecase; disabled: boolean; onApply: Props["onApply"] }) {
  const [editing, setEditing] = useState<string | null>(null);
  const save = (acceptance: Acceptance[]) => onApply([{ op: "upsert", kind: "usecases", element: { id: usecase.id, acceptance } }]);
  const replace = (next: Acceptance) => save(usecase.acceptance.map((a) => (a.id === next.id ? next : a))).then((ok) => ok && setEditing(null));

  return (
    <div className="acceptance">
      <h4>受け入れ条件</h4>
      {usecase.acceptance.length === 0 && <p className="hint">まだありません。この feature で変更したユースケースには 1 件以上必要です。</p>}
      <ul className="relations">
        {usecase.acceptance.map((a) =>
          editing === a.id ? (
            <li key={a.id}>
              <AcceptanceForm initial={a} existing={[]} disabled={disabled} onSave={replace} onCancel={() => setEditing(null)} />
            </li>
          ) : (
            <li key={a.id}>
              <span>
                <code>{a.id}</code> {a.given && <>Given {a.given} / </>}When {a.when} / Then {a.then}
              </span>
              <button disabled={disabled} onClick={() => setEditing(a.id)}>
                編集
              </button>
              <button disabled={disabled} onClick={() => void save(usecase.acceptance.filter((x) => x.id !== a.id))}>
                外す
              </button>
            </li>
          ),
        )}
      </ul>
      <AcceptanceForm
        existing={usecase.acceptance.map((a) => a.id)}
        disabled={disabled}
        onSave={(a) => save([...usecase.acceptance, a])}
      />
    </div>
  );
}

function AcceptanceForm({
  initial,
  existing,
  disabled,
  onSave,
  onCancel,
}: {
  initial?: Acceptance;
  existing: string[];
  disabled: boolean;
  onSave: (a: Acceptance) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const [id, setId] = useState(initial?.id ?? "");
  const [given, setGiven] = useState(initial?.given ?? "");
  const [when, setWhen] = useState(initial?.when ?? "");
  const [then, setThen] = useState(initial?.then ?? "");
  const valid = slugPattern.test(id) && !existing.includes(id) && when.trim() !== "" && then.trim() !== "";

  const submit = async () => {
    const ok = await onSave({ id, given: given.trim() || undefined, when: when.trim(), then: then.trim() });
    if (ok === true && !initial) {
      setId("");
      setGiven("");
      setWhen("");
      setThen("");
    }
  };

  return (
    <div className="add-relation">
      {initial ? (
        <code>{initial.id}</code>
      ) : (
        <input aria-label="受け入れ条件ID" placeholder="ac1" value={id} disabled={disabled} onChange={(e) => setId(e.target.value)} />
      )}
      <input aria-label="Given" placeholder="前提（任意）" value={given} disabled={disabled} onChange={(e) => setGiven(e.target.value)} />
      <input aria-label="When" placeholder="操作" value={when} disabled={disabled} onChange={(e) => setWhen(e.target.value)} />
      <input aria-label="Then" placeholder="結果" value={then} disabled={disabled} onChange={(e) => setThen(e.target.value)} />
      <div className="row">
        <button disabled={disabled || !valid} onClick={() => void submit()}>
          {initial ? "保存" : "受け入れ条件を追加"}
        </button>
        {onCancel && <button onClick={onCancel}>やめる</button>}
      </div>
    </div>
  );
}
