import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { DESIGN_REVIEWS_DIR, REVIEWS_DIR, resolveFeature, type Feature } from "../src/feature.js";
import { rdraHash } from "../src/model/hash.js";
import { decide, emptyReview, requestReview, writeReview } from "../src/review.js";
import { createMcpServer } from "../src/mcp.js";
import { DESIGN_DIR, RDRA_DIR } from "../src/model/io.js";
import { QueryIndex } from "../src/query.js";
import { RdraStore } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeFeatureRepo, makeInvalidFeatureRepo, makeRepo, run } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const cleanups: (() => void)[] = [];
afterEach(() => {
  while (cleanups.length) cleanups.pop()!();
});

async function connect(repo: string, onReviewChange?: () => void) {
  const store = await RdraStore.open(repo);
  cleanups.push(() => store.close());
  const server = createMcpServer({
    store,
    index: new QueryIndex(),
    reviewUrl: () => "http://127.0.0.1:1234/",
    now: () => "2026-09-25T10:00:00+09:00",
    onReviewChange,
  });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(clientTransport);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = (await client.callTool({ name, arguments: args })) as { content: { text: string }[]; isError?: boolean };
    return { isError: res.isError === true, text: res.content[0].text, json: () => JSON.parse(res.content[0].text) };
  };
  return { store, call, client };
}

describe("MCP tools", () => {
  it("requests a design review only after the RDRA approval and once the design realizes the change", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const { call, store } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "information", element: { id: "inf.order", attributes: ["注文番号", "合計金額"] } }] });
    const early = await call("rdra_request_review", { stage: "design" });
    expect(early.isError).toBe(true);
    expect(early.text).toContain("/rdra");

    const feature = (await resolveFeature(repo)) as Feature;
    const T = "2026-10-01T10:00:00+09:00";
    await writeReview(
      feature.reviewFile,
      decide(requestReview(emptyReview(), { now: T }), { decision: "approved", comments: [], hash: rdraHash(store.model), now: T }),
    );
    const gap = await call("rdra_request_review", { stage: "design" });
    expect(gap.isError).toBe(true);
    expect(gap.text).toContain("inf.order");

    await call("rdra_upsert", {
      items: [
        { kind: "components", element: { id: "comp.db", name: "業務 DB", type: "datastore" } },
        { kind: "tables", element: { id: "tbl.orders", name: "注文テーブル", store: "comp.db", realizes: ["inf.order"], states: ["st.order"] } },
      ],
    });
    expect((await call("rdra_request_review", { stage: "design" })).json()).toMatchObject({
      stage: "design",
      status: "pending",
      reviewFile: `${DESIGN_REVIEWS_DIR}/001-demo.json`,
    });
    expect((await call("rdra_review_status")).json()).toMatchObject({
      approval: "approved",
      design: { status: "pending", approval: "pending", required: true },
    });
  });

  it("reports the design as not required for a feature without design work", async () => {
    const { call } = await connect(await makeFeatureRepo(rdraFiles()));
    expect((await call("rdra_review_status")).json().design).toEqual({ status: "none", approval: "none", lastRound: null, required: false });
  });

  it("lists every tool and no approval tool", async () => {
    const { client } = await connect(await makeRepo());
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    expect(names).toEqual([
      "rdra_delete",
      "rdra_diff",
      "rdra_get_model",
      "rdra_link",
      "rdra_query",
      "rdra_request_review",
      "rdra_review_status",
      "rdra_unlink",
      "rdra_upsert",
      "rdra_validate",
    ]);
  });

  it("upserts, links, reads, queries and validates", async () => {
    const { call } = await connect(await makeRepo());
    expect(
      (
        await call("rdra_upsert", {
          items: [
            { kind: "actors", element: { id: "act.customer", name: "顧客" } },
            { kind: "usecases", element: { id: "uc.browse", name: "商品を見る" } },
          ],
        })
      ).isError,
    ).toBe(false);
    expect((await call("rdra_link", { links: [{ relation: "uc.actor", from: "uc.browse", to: "act.customer" }] })).isError).toBe(false);
    const model = (await call("rdra_get_model", { kind: "usecases" })).json();
    expect(model.model.usecases[0].actors).toEqual(["act.customer"]);
    expect(Object.keys(model.model)).toEqual(["usecases"]);
    expect((await call("rdra_query", { sql: "SELECT to_id FROM relations WHERE from_id = 'uc.browse'" })).json()).toEqual([
      { to_id: "act.customer" },
    ]);
    const issues = (await call("rdra_validate")).json().issues.map((i: { code: string }) => i.code);
    expect(issues).toContain("usecase-without-io");
    expect(
      (
        await call("rdra_upsert", {
          items: [{ kind: "principles", element: { id: "pr.audit", name: "監査", description: "d", category: "security", level: "must" } }],
        })
      ).isError,
    ).toBe(false);
    expect((await call("rdra_link", { links: [{ relation: "pr.scope", from: "pr.audit", to: "uc.browse" }] })).isError).toBe(false);
    expect((await call("rdra_get_model", { kind: "principles" })).json().model.principles[0].scope).toEqual(["uc.browse"]);
  });

  it("returns errors for invalid edits and bad SQL", async () => {
    const { call } = await connect(await makeRepo());
    const bad = await call("rdra_link", { links: [{ relation: "uc.actor", from: "uc.none", to: "act.none" }] });
    expect(bad.isError).toBe(true);
    expect(bad.text).toContain("invalid-operation");
    expect((await call("rdra_query", { sql: "DELETE FROM elements" })).isError).toBe(true);
  });

  it("deletes with cascade and reports removed relations", async () => {
    const { call } = await connect(await makeRepo(rdraFiles()));
    const res = (await call("rdra_delete", { ids: ["scr.cart"] })).json();
    expect(res.removedRelations).toEqual([{ from: "uc.place-order", to: "scr.cart", kind: "uc.screen", attrs: {} }]);
  });

  it("diffs against the base commit", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const { call } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "screens", element: { id: "scr.top", name: "トップ" } }] });
    const diff = (await call("rdra_diff")).json();
    expect(diff.changes.map((c: { id: string; type: string }) => `${c.type}:${c.id}`)).toEqual(["added:scr.top"]);
  });

  it("refuses to request a review outside a feature or with errors", async () => {
    const outside = await connect(await makeRepo(rdraFiles()));
    expect((await outside.call("rdra_request_review")).isError).toBe(true);

    const invalid = await connect(await makeInvalidFeatureRepo(rdraFiles()));
    const refused = await invalid.call("rdra_request_review");
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("feature/<id>");
    expect((await invalid.call("rdra_review_status")).json().note).toContain("feature/<id>");

    const repo = await makeFeatureRepo({ ...rdraFiles(), [`${RDRA_DIR}/screens.yaml`]: "[]\n" });
    const inside = await connect(repo);
    const res = await inside.call("rdra_request_review");
    expect(res.isError).toBe(true);
    expect(res.text).toContain("scr.cart");
  });

  it("requests a review and reports its status", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    let notified = 0;
    const { call } = await connect(repo, () => (notified += 1));
    const res = (await call("rdra_request_review")).json();
    expect(res).toMatchObject({ status: "pending", url: "http://127.0.0.1:1234/", reviewFile: `${REVIEWS_DIR}/001-demo.json` });
    expect(notified).toBe(1);
    const record = JSON.parse(await readFile(join(repo, REVIEWS_DIR, "001-demo.json"), "utf8"));
    expect(record.status).toBe("pending");
    expect(record).not.toHaveProperty("base_commit");
    expect((await call("rdra_review_status")).json()).toMatchObject({ status: "pending", approval: "pending", lastRound: null });
  });

  it("refuses to validate the feature or request a review when no diff base resolves", async () => {
    const repo = await makeRepo(rdraFiles());
    run(repo, "git", ["checkout", "-q", "-b", "feature/001-demo"]);
    const { call } = await connect(repo);
    for (const tool of ["rdra_validate", "rdra_request_review"]) {
      const res = await call(tool);
      expect(res.isError).toBe(true);
      expect(res.text).toContain("差分の基点が見つかりません");
    }
    await expect(readFile(join(repo, REVIEWS_DIR, "001-demo.json"), "utf8")).rejects.toThrow();
  });

  it("checks that the design realizes the feature's change and writes docs/design", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const { call } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "information", element: { id: "inf.order", attributes: ["注文番号", "合計金額"] } }] });
    const before = (await call("rdra_validate")).json();
    expect(before.featureIssues).toEqual([]);
    expect(before.designFeatureIssues.map((i: { code: string }) => i.code)).toEqual(["information-not-realized"]);

    const upsert = await call("rdra_upsert", {
      items: [
        { kind: "components", element: { id: "comp.db", name: "業務 DB", type: "datastore", doc: "docs/design/er.md" } },
        { kind: "tables", element: { id: "tbl.orders", name: "注文テーブル", store: "comp.db", realizes: ["inf.order"], states: ["st.order"] } },
      ],
    });
    expect(upsert.isError).toBe(false);
    const after = (await call("rdra_validate")).json();
    expect(after.designFeatureIssues).toEqual([]);
    expect(after.issues.map((i: { code: string }) => i.code)).toContain("missing-doc");
    expect(await readFile(join(repo, DESIGN_DIR, "tables.yaml"), "utf8")).toContain("tbl.orders");
    expect((await call("rdra_query", { sql: "SELECT id FROM tables" })).json()).toEqual([{ id: "tbl.orders" }]);
  });

  it("refuses a review while a changed usecase has no acceptance criteria", async () => {
    const repo = await makeFeatureRepo(rdraFiles());
    const { call } = await connect(repo);
    await call("rdra_upsert", { items: [{ kind: "usecases", element: { id: "uc.place-order", name: "注文を確定する" } }] });
    expect((await call("rdra_validate")).json().featureIssues.map((i: { code: string }) => i.code)).toEqual(["usecase-without-acceptance"]);
    const refused = await call("rdra_request_review");
    expect(refused.isError).toBe(true);
    expect(refused.text).toContain("uc.place-order");

    await call("rdra_upsert", {
      items: [{ kind: "usecases", element: { id: "uc.place-order", acceptance: [{ id: "ac1", when: "注文する", then: "作られる" }] } }],
    });
    expect((await call("rdra_request_review")).isError).toBe(false);
  });
});
