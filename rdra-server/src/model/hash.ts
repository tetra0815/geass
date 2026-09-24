import { createHash } from "node:crypto";
import { KINDS, type Model } from "./kinds.js";

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

export function canonicalModel(model: Model): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const kind of KINDS) {
    out[kind.key] = [...model[kind.key]]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map(canonicalize);
  }
  return out;
}

export function modelHash(model: Model): string {
  return "sha256:" + createHash("sha256").update(JSON.stringify(canonicalModel(model))).digest("hex");
}
