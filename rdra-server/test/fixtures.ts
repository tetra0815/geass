import { parseModel, type FileMap } from "../src/model/io.js";
import type { Model } from "../src/model/kinds.js";

export function sampleFiles(): FileMap {
  return {
    "actors.yaml": "- id: act.customer\n  name: 顧客\n",
    "external-systems.yaml": "- id: ext.payment-gateway\n  name: 決済代行\n",
    "bucs.yaml": [
      "- id: buc.ordering",
      "  name: 注文受付",
      "  business: 販売",
      "  actors: [act.customer]",
      "  usecases: [uc.place-order]",
      "",
    ].join("\n"),
    "usecases.yaml": [
      "- id: uc.place-order",
      "  name: 注文する",
      "  actors: [act.customer]",
      "  screens: [scr.cart]",
      "  events: [evt.payment-request]",
      "  information:",
      "    - { ref: inf.order, access: create }",
      "  transitions: [\"st.order:draft->placed\"]",
      "",
    ].join("\n"),
    "screens.yaml": "- id: scr.cart\n  name: カート\n",
    "events.yaml": "- id: evt.payment-request\n  name: 決済依頼\n  target: ext.payment-gateway\n",
    "information.yaml": "- id: inf.order\n  name: 注文\n  attributes: [注文番号]\n",
    "states.yaml": [
      "- id: st.order",
      "  name: 注文状態",
      "  information: inf.order",
      "  states:",
      "    - { id: draft, name: 下書き }",
      "    - { id: placed, name: 注文済み }",
      "  transitions:",
      "    - { from: draft, to: placed }",
      "",
    ].join("\n"),
  };
}

export function sampleModel(): Model {
  return parseModel(sampleFiles());
}

/** The sample model's design: a web app, a payment adapter, the business DB with the order table, and one decision. */
export function sampleDesignFiles(): FileMap {
  return {
    "design/components.yaml": [
      "- id: comp.web",
      "  name: Web アプリ",
      "  type: app",
      "  tech: Next.js 16",
      "  dependsOn:",
      "    - { ref: comp.db, label: 注文の読み書き }",
      "    - { ref: comp.payment-adapter }",
      "- id: comp.payment-adapter",
      "  name: 決済連携",
      "  type: app",
      "  realizes: [ext.payment-gateway]",
      "- id: comp.db",
      "  name: 業務 DB",
      "  type: datastore",
      "  tech: PostgreSQL 17",
      "",
    ].join("\n"),
    "design/tables.yaml": [
      "- id: tbl.orders",
      "  name: 注文テーブル",
      "  store: comp.db",
      "  realizes: [inf.order]",
      "  states: [st.order]",
      "  key: order_id (uuid)",
      "",
    ].join("\n"),
    "design/decisions.yaml": [
      "- id: adr.postgres",
      "  name: 業務データは PostgreSQL に置く",
      "  status: accepted",
      "  context: 注文の整合性が必要",
      "  decision: PostgreSQL 17 を使う",
      "  alternatives: [DynamoDB（トランザクションが弱い）]",
      "  affects: [comp.db]",
      "",
    ].join("\n"),
  };
}

export function sampleFullModel(): Model {
  return parseModel({ ...sampleFiles(), ...sampleDesignFiles() });
}
