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
