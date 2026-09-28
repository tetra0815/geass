import type { DatabaseSync } from "node:sqlite";
import { KINDS, acceptanceRef, type AnyElement, type Model } from "./model/kinds.js";
import { formatTransitionRef, relationsOf } from "./model/relations.js";

function openDatabase(): DatabaseSync {
  const sqlite = process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  return new sqlite.DatabaseSync(":memory:");
}

export class QueryIndex {
  private readonly db: DatabaseSync;

  constructor() {
    this.db = openDatabase();
    this.db.exec(`
      CREATE TABLE elements (id TEXT NOT NULL, kind TEXT NOT NULL, name TEXT NOT NULL, description TEXT, data TEXT NOT NULL);
      CREATE TABLE relations (from_id TEXT NOT NULL, to_id TEXT NOT NULL, kind TEXT NOT NULL, attrs TEXT NOT NULL);
      CREATE TABLE state_nodes (model_id TEXT NOT NULL, state_id TEXT NOT NULL, name TEXT NOT NULL);
      CREATE TABLE state_transitions (model_id TEXT NOT NULL, from_state TEXT NOT NULL, to_state TEXT NOT NULL, ref TEXT NOT NULL);
      CREATE TABLE acceptance (usecase_id TEXT NOT NULL, ac_id TEXT NOT NULL, ref TEXT NOT NULL, given_text TEXT, when_text TEXT NOT NULL, then_text TEXT NOT NULL);
      CREATE VIEW principle_scope AS SELECT from_id AS principle_id, to_id AS target_id FROM relations WHERE kind = 'pr.scope';
      ${KINDS.map((k) => `CREATE VIEW ${k.table} AS SELECT * FROM elements WHERE kind = '${k.key}';`).join("\n")}
    `);
  }

  rebuild(model: Model): void {
    this.db.exec("PRAGMA query_only = OFF");
    this.db.exec("BEGIN");
    try {
      this.db.exec("DELETE FROM elements; DELETE FROM relations; DELETE FROM state_nodes; DELETE FROM state_transitions; DELETE FROM acceptance;");
      const insertElement = this.db.prepare("INSERT INTO elements VALUES (?, ?, ?, ?, ?)");
      for (const kind of KINDS) {
        for (const e of model[kind.key] as AnyElement[]) {
          insertElement.run(e.id, kind.key, e.name, e.description ?? null, JSON.stringify(e));
        }
      }
      const insertRelation = this.db.prepare("INSERT INTO relations VALUES (?, ?, ?, ?)");
      for (const r of relationsOf(model)) insertRelation.run(r.from, r.to, r.kind, JSON.stringify(r.attrs));
      const insertState = this.db.prepare("INSERT INTO state_nodes VALUES (?, ?, ?)");
      const insertTransition = this.db.prepare("INSERT INTO state_transitions VALUES (?, ?, ?, ?)");
      for (const sm of model.states) {
        for (const s of sm.states) insertState.run(sm.id, s.id, s.name);
        for (const t of sm.transitions) {
          insertTransition.run(sm.id, t.from, t.to, formatTransitionRef({ model: sm.id, from: t.from, to: t.to }));
        }
      }
      const insertAcceptance = this.db.prepare("INSERT INTO acceptance VALUES (?, ?, ?, ?, ?, ?)");
      for (const uc of model.usecases) {
        for (const ac of uc.acceptance) insertAcceptance.run(uc.id, ac.id, acceptanceRef(uc.id, ac.id), ac.given ?? null, ac.when, ac.then);
      }
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    } finally {
      this.db.exec("PRAGMA query_only = ON");
    }
  }

  query(sql: string): Record<string, unknown>[] {
    return this.db.prepare(sql).all() as Record<string, unknown>[];
  }
}
