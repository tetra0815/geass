import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it } from "vitest";
import { REVIEWS_DIR } from "../src/feature.js";
import { createMcpServer } from "../src/mcp.js";
import { RDRA_DIR } from "../src/model/io.js";
import { QueryIndex } from "../src/query.js";
import { RdraStore } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeFeatureRepo, makeRepo } from "./helpers.js";

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
});
