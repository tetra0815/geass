import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { LineCounter, parseDocument, stringify, type Document } from "yaml";
import { KINDS, emptyModel, type AnyElement, type Model } from "./kinds.js";

export const RDRA_DIR = "docs/rdra";
export type FileMap = Record<string, string>;

export class ModelParseError extends Error {
  constructor(
    readonly file: string,
    readonly line: number | null,
    readonly detail: string,
  ) {
    super(`${file}${line ? `:${line}` : ""}: ${detail}`);
    this.name = "ModelParseError";
  }
}

function lineOf(doc: Document, counter: LineCounter, path: (string | number)[]): number | null {
  for (let n = path.length; n > 0; n--) {
    const node = doc.getIn(path.slice(0, n), true) as { range?: [number, number, number] } | undefined;
    if (node && node.range) return counter.linePos(node.range[0]).line;
  }
  return null;
}

export function parseModel(files: FileMap): Model {
  const model = emptyModel();
  for (const kind of KINDS) {
    const text = files[kind.file];
    if (text === undefined || text.trim() === "") continue;
    const counter = new LineCounter();
    const doc = parseDocument(text, { lineCounter: counter });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      throw new ModelParseError(kind.file, first.linePos?.[0]?.line ?? null, first.message);
    }
    const data: unknown = doc.toJS();
    if (data === null || data === undefined) continue;
    if (!Array.isArray(data)) throw new ModelParseError(kind.file, 1, "トップレベルはリストにしてください");
    data.forEach((raw, i) => {
      const result = kind.schema.safeParse(raw);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = [i, ...issue.path.filter((p): p is string | number => typeof p !== "symbol")];
        throw new ModelParseError(kind.file, lineOf(doc, counter, path), `[${path.join(".")}] ${issue.message}`);
      }
      (model[kind.key] as AnyElement[]).push(result.data as AnyElement);
    });
  }
  return model;
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, v] of Object.entries(value)) {
      if (v === undefined || v === null) continue;
      if (Array.isArray(v) && v.length === 0) continue;
      out[key] = prune(v);
    }
    return out;
  }
  return value;
}

export function serializeModel(model: Model): FileMap {
  const files: FileMap = {};
  for (const kind of KINDS) {
    const items = model[kind.key];
    files[kind.file] = items.length === 0 ? "[]\n" : stringify(prune(items), { lineWidth: 0 });
  }
  return files;
}

export async function readModelFiles(repoRoot: string): Promise<FileMap> {
  const files: FileMap = {};
  for (const kind of KINDS) {
    try {
      files[kind.file] = await readFile(join(repoRoot, RDRA_DIR, kind.file), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return files;
}

export async function writeModelFiles(repoRoot: string, files: FileMap, previous: FileMap): Promise<string[]> {
  const changed = Object.keys(files).filter((file) => previous[file] !== files[file]);
  if (changed.length === 0) return [];
  await mkdir(join(repoRoot, RDRA_DIR), { recursive: true });
  for (const file of changed) {
    await writeFile(join(repoRoot, RDRA_DIR, file), files[file], "utf8");
  }
  return changed;
}
