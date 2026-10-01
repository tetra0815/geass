import { createHash } from "node:crypto";
import { KINDS, type KindDef, type Model } from "./kinds.js";

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const v = source[key];
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

export function canonicalModel(model: Model, kinds: readonly KindDef[] = KINDS): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of kinds) {
    out[kind.key] = [...model[kind.key]]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(canonicalize);
  }
  return out;
}

function hashOf(value: unknown): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

const RDRA_KINDS = KINDS.filter((k) => k.layer === "rdra");

/** Every layer: the store's version and the design approval hash. */
export function modelHash(model: Model): string {
  return hashOf(canonicalModel(model));
}

/** The RDRA layer only: what an RDRA approval covers. Equal to 0.12.0's modelHash for the same RDRA model. */
export function rdraHash(model: Model): string {
  return hashOf(canonicalModel(model, RDRA_KINDS));
}
