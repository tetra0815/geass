import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { LineCounter, parseDocument, stringify, type Document } from "yaml";
import { KINDS, emptyModel, type AnyElement, type KindDef, type Model } from "./kinds.js";

export const RDRA_DIR = "docs/rdra";
export const DESIGN_DIR = "docs/design";
export type FileMap = Record<string, string>;

/** The FileMap key of a kind: RDRA files keep their bare names, design files are prefixed with design/. */
export function fileKey(kind: KindDef): string {
  return kind.layer === "rdra" ? kind.file : `design/${kind.file}`;
}

/** The kind's file relative to the repository root. */
export function repoPath(kind: KindDef): string {
  return `${kind.layer === "rdra" ? RDRA_DIR : DESIGN_DIR}/${kind.file}`;
}

const PATH_OF_KEY = new Map(KINDS.map((k) => [fileKey(k), repoPath(k)]));
const EMPTY_FILE = "[]\n";

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
    const key = fileKey(kind);
    const text = files[key];
    if (text === undefined || text.trim() === "") continue;
    const counter = new LineCounter();
    const doc = parseDocument(text, { lineCounter: counter });
    if (doc.errors.length > 0) {
      const first = doc.errors[0];
      throw new ModelParseError(key, first.linePos?.[0]?.line ?? null, first.message);
    }
    const data: unknown = doc.toJS();
    if (data === null || data === undefined) continue;
    if (!Array.isArray(data)) throw new ModelParseError(key, 1, "トップレベルはリストにしてください");
    data.forEach((raw, i) => {
      const result = kind.schema.safeParse(raw);
      if (!result.success) {
        const issue = result.error.issues[0];
        const path = [i, ...issue.path.filter((p): p is string | number => typeof p !== "symbol")];
        throw new ModelParseError(key, lineOf(doc, counter, path), `[${path.join(".")}] ${issue.message}`);
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
    files[fileKey(kind)] = items.length === 0 ? "[]\n" : stringify(prune(items), { lineWidth: 0 });
  }
  return files;
}

export async function readModelFiles(repoRoot: string): Promise<FileMap> {
  const files: FileMap = {};
  for (const kind of KINDS) {
    try {
      files[fileKey(kind)] = await readFile(join(repoRoot, repoPath(kind)), "utf8");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
  }
  return files;
}

export async function writeModelFiles(repoRoot: string, files: FileMap, previous: FileMap): Promise<string[]> {
  // A project that has not started its design yet keeps no docs/design.
  const skip = (key: string) => key.startsWith("design/") && previous[key] === undefined && files[key] === EMPTY_FILE;
  const changed = Object.keys(files).filter((key) => previous[key] !== files[key] && !skip(key));
  for (const key of changed) {
    const path = join(repoRoot, PATH_OF_KEY.get(key)!);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, files[key], "utf8");
  }
  return changed;
}
