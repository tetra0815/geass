import { EventEmitter } from "node:events";
import { existsSync, watch, type FSWatcher } from "node:fs";
import { join } from "node:path";
import { modelHash } from "./model/hash.js";
import {
  ModelParseError,
  RDRA_DIR,
  parseModel,
  readModelFiles,
  serializeModel,
  writeModelFiles,
  type FileMap,
} from "./model/io.js";
import { emptyModel, type Model } from "./model/kinds.js";
import type { Relation } from "./model/relations.js";
import { OperationError, applyOperations, type Operation } from "./operations.js";
import { validate, type Issue } from "./validate.js";

export type ApplyResult =
  | { ok: true; version: string; removedRelations: Relation[] }
  | {
      ok: false;
      reason: "conflict" | "parse-error" | "invalid-operation" | "introduces-errors";
      message: string;
      issues?: Issue[];
    };

export interface StoreChange {
  version: string;
  parseError: string | null;
}

const issueKey = (i: Issue) => `${i.code}|${i.elementId ?? ""}|${i.message}`;

export class RdraStore extends EventEmitter {
  private current: Model = emptyModel();
  private files: FileMap = {};
  private currentVersion = modelHash(emptyModel());
  private error: ModelParseError | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private watcher: FSWatcher | null = null;
  private watching = false;
  private reloadTimer: NodeJS.Timeout | null = null;

  private constructor(readonly repoRoot: string) {
    super();
  }

  static async open(repoRoot: string): Promise<RdraStore> {
    const store = new RdraStore(repoRoot);
    await store.reload();
    return store;
  }

  get model(): Model {
    return this.current;
  }

  get version(): string {
    return this.currentVersion;
  }

  get parseError(): ModelParseError | null {
    return this.error;
  }

  reload(): Promise<void> {
    return this.enqueue(() => this.reloadNow());
  }

  apply(ops: Operation[], opts: { expectedVersion?: string } = {}): Promise<ApplyResult> {
    return this.enqueue(() => this.applyNow(ops, opts));
  }

  watch(): void {
    this.watching = true;
    this.startWatcher();
  }

  close(): void {
    this.watching = false;
    this.watcher?.close();
    this.watcher = null;
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = null;
  }

  private startWatcher(): void {
    if (!this.watching || this.watcher) return;
    const dir = join(this.repoRoot, RDRA_DIR);
    if (!existsSync(dir)) return;
    this.watcher = watch(dir, () => this.scheduleReload());
  }

  private scheduleReload(): void {
    if (this.reloadTimer) clearTimeout(this.reloadTimer);
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null;
      void this.reload();
    }, 100);
  }

  private emitChange(): void {
    const change: StoreChange = { version: this.currentVersion, parseError: this.error?.message ?? null };
    this.emit("change", change);
  }

  private async reloadNow(): Promise<void> {
    const files = await readModelFiles(this.repoRoot);
    let model: Model;
    try {
      model = parseModel(files);
    } catch (e) {
      if (!(e instanceof ModelParseError)) throw e;
      const changed = this.error?.message !== e.message;
      this.error = e;
      if (changed) this.emitChange();
      return;
    }
    const version = modelHash(model);
    const recovered = this.error !== null;
    this.error = null;
    this.files = files;
    this.current = model;
    if (version !== this.currentVersion || recovered) {
      this.currentVersion = version;
      this.emitChange();
    }
  }

  private async applyNow(ops: Operation[], opts: { expectedVersion?: string }): Promise<ApplyResult> {
    if (this.error) {
      return { ok: false, reason: "parse-error", message: `YAML を修正するまで編集できません: ${this.error.message}` };
    }
    if (opts.expectedVersion && opts.expectedVersion !== this.currentVersion) {
      return { ok: false, reason: "conflict", message: "モデルが更新されています。最新の状態を読み込み直してください" };
    }
    let next: { model: Model; removedRelations: Relation[] };
    try {
      next = applyOperations(this.current, ops);
    } catch (e) {
      if (e instanceof OperationError) return { ok: false, reason: "invalid-operation", message: e.message };
      throw e;
    }
    const existing = new Set(validate(this.current).filter((i) => i.level === "error").map(issueKey));
    const introduced = validate(next.model).filter((i) => i.level === "error" && !existing.has(issueKey(i)));
    if (introduced.length > 0) {
      return { ok: false, reason: "introduces-errors", message: introduced.map((i) => i.message).join("\n"), issues: introduced };
    }
    const files = serializeModel(next.model);
    await writeModelFiles(this.repoRoot, files, this.files);
    this.files = files;
    this.current = next.model;
    const version = modelHash(next.model);
    if (version !== this.currentVersion) {
      this.currentVersion = version;
      this.emitChange();
    }
    this.startWatcher();
    return { ok: true, version, removedRelations: next.removedRelations };
  }

  private enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn, fn);
    this.queue = run.catch(() => undefined);
    return run;
  }
}
