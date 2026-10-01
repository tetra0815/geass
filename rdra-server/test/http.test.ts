import { EventEmitter } from "node:events";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { request } from "node:http";
import { createConnection } from "node:net";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { DESIGN_REVIEWS_DIR, REVIEWS_DIR } from "../src/feature.js";
import { startHttp, type RdraHttp } from "../src/http.js";
import { rdraHash } from "../src/model/hash.js";
import { RDRA_DIR } from "../src/model/io.js";
import { emptyReview, requestReview, writeReview } from "../src/review.js";
import { RdraStore } from "../src/store.js";
import { sampleFiles } from "./fixtures.js";
import { makeFeatureRepo, makeRepo } from "./helpers.js";

const rdraFiles = () => Object.fromEntries(Object.entries(sampleFiles()).map(([f, c]) => [`${RDRA_DIR}/${f}`, c]));
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function setup(opts: { webRoot?: string | null; feature?: boolean } = {}) {
  const repo = opts.feature === false ? await makeRepo(rdraFiles()) : await makeFeatureRepo(rdraFiles());
  const store = await RdraStore.open(repo);
  const reviewEvents = new EventEmitter();
  const http: RdraHttp = await startHttp({ store, reviewEvents, webRoot: opts.webRoot ?? null, now: () => "2026-09-25T10:00:00+09:00" });
  cleanups.push(() => store.close(), () => http.close());
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = { "x-rdra-client": "web" }) => {
    const res = await fetch(new URL(path, http.url), {
      method,
      headers: { "content-type": "application/json", ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const isJson = res.headers.get("content-type")?.startsWith("application/json") ?? false;
    return { status: res.status, body: isJson ? JSON.parse(text) : null, text };
  };
  return { repo, store, http, call, reviewEvents, reviewFile: join(repo, REVIEWS_DIR, "001-demo.json") };
}

describe("HTTP API", () => {
  it("serves the current state", async () => {
    const { call, store } = await setup();
    const { status, body } = await call("GET", "/api/state");
    expect(status).toBe(200);
    expect(body).toMatchObject({ version: store.version, parseError: null, approval: "none", review: { status: "none" }, design: { approval: "none", required: false } });
    expect(body.model.usecases[0].id).toBe("uc.place-order");
    expect(body.issues).toEqual([]);
    expect(body.layout["usecase-composite"]).toEqual({});
  });

  it("records design decisions in docs/design/reviews with the full hash", async () => {
    const { call, store, repo } = await setup();
    const designFile = join(repo, DESIGN_REVIEWS_DIR, "001-demo.json");
    await writeReview(designFile, requestReview(emptyReview(), { now: "t" }));
    expect((await call("GET", "/api/state")).body.design).toMatchObject({ approval: "pending", required: false, review: { status: "pending" } });
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version, stage: "nope" })).status).toBe(400);

    const res = await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version, stage: "design" });
    expect(res.status).toBe(200);
    expect(JSON.parse(await readFile(designFile, "utf8"))).toMatchObject({ status: "approved", approved_hash: store.version });
    expect((await call("GET", "/api/state")).body).toMatchObject({ approval: "none", design: { approval: "approved" } });
  });

  it("says the design is required once the feature changes it", async () => {
    const { call, store } = await setup();
    await store.apply([{ op: "upsert", kind: "components", element: { id: "comp.db", name: "業務 DB", type: "datastore" } }]);
    expect((await call("GET", "/api/state")).body.design).toMatchObject({ approval: "none", required: true, review: { status: "none" } });
  });

  it("keeps an RDRA approval when only the design changes", async () => {
    const { call, store, reviewFile } = await setup();
    await writeReview(reviewFile, requestReview(emptyReview(), { now: "t" }));
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version })).status).toBe(200);
    await store.apply([{ op: "upsert", kind: "components", element: { id: "comp.db", name: "業務 DB", type: "datastore" } }]);
    expect((await call("GET", "/api/state")).body.approval).toBe("approved");
  });

  it("applies operations with optimistic locking", async () => {
    const { call, store, repo } = await setup();
    const op = { op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } };
    expect((await call("POST", "/api/ops", { expectedVersion: "sha256:stale", ops: [op] })).status).toBe(409);
    const ok = await call("POST", "/api/ops", { expectedVersion: store.version, ops: [op] });
    expect(ok.status).toBe(200);
    expect(ok.body.ok).toBe(true);
    expect(await readFile(join(repo, RDRA_DIR, "screens.yaml"), "utf8")).toContain("scr.top");
    const bad = await call("POST", "/api/ops", { ops: [{ op: "delete", id: "scr.none" }] });
    expect(bad.status).toBe(422);
  });

  it("rejects mutations without the client header or from foreign hosts", async () => {
    const { call, http } = await setup();
    expect((await call("POST", "/api/ops", { ops: [] }, {})).status).toBe(403);
    const port = Number(new URL(http.url).port);
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/api/state", headers: { host: `evil.example:${port}` } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it("saves layout per view", async () => {
    const { call } = await setup();
    expect((await call("PUT", "/api/layout/information-model", { positions: { "inf.order": { x: 3, y: 4 } } })).status).toBe(204);
    expect((await call("GET", "/api/state")).body.layout["information-model"]).toEqual({ "inf.order": { x: 3, y: 4 } });
    expect((await call("PUT", "/api/layout/nope", { positions: {} })).status).toBe(404);
  });

  it("returns the diff against the base commit", async () => {
    const { call, store } = await setup();
    await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    const { body } = await call("GET", "/api/diff");
    expect(body.changes.map((c: { id: string }) => c.id)).toEqual(["scr.top"]);
  });

  it("records decisions only for pending reviews at the current version", async () => {
    const { call, store, reviewFile, reviewEvents } = await setup();
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version })).status).toBe(422);

    await writeReview(reviewFile, requestReview(emptyReview(), { now: "t" }));
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: "sha256:old" })).status).toBe(409);
    expect((await call("POST", "/api/review/decision", { decision: "rejected", comments: [], version: store.version })).status).toBe(422);

    let notified = 0;
    reviewEvents.on("review", () => (notified += 1));
    const rejected = await call("POST", "/api/review/decision", {
      decision: "rejected",
      comments: [{ target: "uc.place-order", text: "在庫の扱いを書いて" }],
      version: store.version,
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.review.status).toBe("rejected");
    expect(notified).toBe(1);

    await writeReview(reviewFile, requestReview(rejected.body.review, { now: "t" }));
    const approved = await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version });
    expect(approved.status).toBe(200);
    const record = JSON.parse(await readFile(reviewFile, "utf8"));
    expect(record).toMatchObject({ status: "approved", approved_hash: rdraHash(store.model) });
    expect(record.rounds).toHaveLength(2);
  });

  it("refuses approval while errors remain", async () => {
    const { call, store, repo, reviewFile } = await setup();
    await writeFile(join(repo, RDRA_DIR, "screens.yaml"), "[]\n");
    await store.reload();
    await writeReview(reviewFile, requestReview(emptyReview(), { now: "t" }));
    const res = await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version });
    expect(res.status).toBe(422);
    expect(res.body.message).toContain("エラー");
  });

  it("refuses decisions outside a feature", async () => {
    const { call, store } = await setup({ feature: false });
    expect((await call("POST", "/api/review/decision", { decision: "approved", comments: [], version: store.version })).status).toBe(404);
  });

  it("pushes change notifications over WebSocket", async () => {
    const { http, store } = await setup();
    const ws = new WebSocket(new URL("/ws", http.url.replace("http", "ws")));
    await new Promise((resolve) => ws.once("open", resolve));
    const message = new Promise<string>((resolve) => ws.once("message", (data) => resolve(String(data))));
    await store.apply([{ op: "upsert", kind: "screens", element: { id: "scr.top", name: "トップ" } }]);
    expect(JSON.parse(await message)).toEqual({ type: "model" });
    ws.close();
  });

  it("survives WebSocket protocol errors", async () => {
    const { http } = await setup();
    const port = Number(new URL(http.url).port);
    await new Promise<void>((resolve, reject) => {
      const socket = createConnection({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        const upgradeRequest = [
          "GET /ws HTTP/1.1",
          "Host: 127.0.0.1:" + port,
          "Upgrade: websocket",
          "Connection: Upgrade",
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
          "Sec-WebSocket-Version: 13",
          "",
          "",
        ].join("\r\n");
        socket.write(upgradeRequest);
        let headerDone = false;
        socket.on("data", (data) => {
          if (!headerDone) {
            const text = data.toString();
            if (text.includes("101")) {
              headerDone = true;
              const unmaskedFrame = Buffer.from([0x81, 0x02, 0x68, 0x69]);
              socket.write(unmaskedFrame);
              socket.destroy();
              resolve();
            }
          }
        });
      });
      socket.on("error", reject);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const res = await fetch(new URL("/api/state", http.url));
    expect(res.status).toBe(200);
  });

  it("serves the web app with an SPA fallback and blocks traversal", async () => {
    const { repo } = await setup();
    const webRoot = join(repo, "web-dist");
    await mkdir(join(webRoot, "assets"), { recursive: true });
    await writeFile(join(webRoot, "index.html"), "<html>rdra</html>");
    await writeFile(join(webRoot, "assets", "app.js"), "console.log(1)");
    await writeFile(join(repo, "secret.js"), "TOP-SECRET");
    const { call, http } = await setup({ webRoot });
    expect((await call("GET", "/")).text).toBe("<html>rdra</html>");
    expect((await call("GET", "/some/route")).text).toBe("<html>rdra</html>");
    expect((await call("GET", "/assets/app.js")).text).toBe("console.log(1)");
    expect((await call("GET", "/assets/missing.js")).status).toBe(404);
    const port = Number(new URL(http.url).port);
    const text = await new Promise<string>((resolve, reject) => {
      const req = request({ host: "127.0.0.1", port, path: "/..%2Fsecret.js" }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      });
      req.on("error", reject);
      req.end();
    });
    expect(text).not.toContain("TOP-SECRET");
  });

  it("explains when the web app is not built", async () => {
    const { call } = await setup();
    const res = await call("GET", "/");
    expect(res.status).toBe(503);
    expect(res.text).toContain("ビルドされていません");
  });
});
