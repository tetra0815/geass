import { useState } from "react";
import { KINDS, SLUG, type KindKey } from "../../../src/model/kinds.js";
import type { Operation } from "../../../src/operations.js";

interface Props {
  disabled: boolean;
  onApply: (ops: Operation[]) => Promise<boolean>;
}

const slugPattern = new RegExp(`^${SLUG}$`);
const ADDABLE = KINDS.filter((k) => k.layer === "rdra" && k.key !== "principles");

export function Palette({ disabled, onApply }: Props) {
  const [kind, setKind] = useState<KindKey>("usecases");
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const prefix = ADDABLE.find((k) => k.key === kind)!.prefix;
  const valid = slugPattern.test(slug) && name.trim() !== "";

  const add = async () => {
    if (await onApply([{ op: "upsert", kind, element: { id: `${prefix}.${slug}`, name: name.trim() } }])) {
      setSlug("");
      setName("");
    }
  };

  return (
    <form
      className="palette"
      onSubmit={(e) => {
        e.preventDefault();
        if (valid) void add();
      }}
    >
      <label>
        種類
        <select aria-label="種類" value={kind} disabled={disabled} onChange={(e) => setKind(e.target.value as KindKey)}>
          {ADDABLE.map((k) => (
            <option key={k.key} value={k.key}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      <label>
        ID
        <span className="id-input">
          {prefix}.
          <input aria-label="ID" value={slug} disabled={disabled} placeholder="place-order" onChange={(e) => setSlug(e.target.value)} />
        </span>
      </label>
      <label>
        名前
        <input aria-label="名前" value={name} disabled={disabled} onChange={(e) => setName(e.target.value)} />
      </label>
      <button type="submit" disabled={disabled || !valid}>
        追加
      </button>
    </form>
  );
}
