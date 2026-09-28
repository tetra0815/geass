import type { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { extname, join, normalize, sep } from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import { diffAgainstBase } from "./base-diff.js";
import { isInvalidFeature, resolveFeature } from "./feature.js";
import { readLayout } from "./layout.js";
import { ModelParseError } from "./model/io.js";
import { isViewKey, type Positions } from "./model/view-keys.js";
import type { Operation } from "./operations.js";
import { ReviewError, approvalState, decide, readReview, writeReview, type ReviewComment } from "./review.js";
import type { RdraStore } from "./store.js";
import { hasErrors, validate } from "./validate.js";

export interface HttpDeps {
  store: RdraStore;
  reviewEvents: EventEmitter;
  webRoot: string | null;
  now?: () => string;
}

export interface RdraHttp {
  url: string;
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".map": "application/json",
};

const MAX_BODY = 1024 * 1024;

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function allowedHost(req: IncomingMessage): boolean {
  return /^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? "");
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new HttpError(413, "リクエストが大きすぎます");
    chunks.push(chunk as Buffer);
  }
  try {
    const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (value === null || typeof value !== "object" || Array.isArray(value)) throw new Error("not an object");
    return value as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "JSON を解釈できません");
  }
}

export async function startHttp(deps: HttpDeps, port = 0): Promise<RdraHttp> {
  const { store, reviewEvents, webRoot } = deps;
  const now = deps.now ?? (() => new Date().toISOString());
  const sockets = new Set<WebSocket>();

  const broadcast = (message: unknown) => {
    const text = JSON.stringify(message);
    for (const socket of sockets) socket.send(text);
  };
  const onModel = () => broadcast({ type: "model" });
  const onLayout = () => broadcast({ type: "layout" });
  const onReview = () => broadcast({ type: "review" });
  store.on("change", onModel);
  store.on("layout", onLayout);
  reviewEvents.on("review", onReview);

  async function state() {
    const resolved = await resolveFeature(store.repoRoot);
    const feature = isInvalidFeature(resolved) ? null : resolved;
    const review = feature ? await readReview(feature.reviewFile) : null;
    return {
      version: store.version,
      parseError: store.parseError?.message ?? null,
      model: store.model,
      issues: validate(store.model),
      layout: await readLayout(store.repoRoot),
      feature: feature?.id ?? null,
      review,
      approval: review ? approvalState(review, store.version).state : "none",
    };
  }

  async function diff() {
    try {
      return await diffAgainstBase(store.repoRoot, store.model);
    } catch (e) {
      if (e instanceof ModelParseError) return { base: null, changes: [], note: `分岐点の RDRA を読めません: ${e.message}` };
      throw e;
    }
  }

  async function applyOps(body: Record<string, unknown>, res: ServerResponse) {
    if (!Array.isArray(body.ops)) throw new HttpError(400, "ops が必要です");
    const result = await store.apply(body.ops as Operation[], {
      expectedVersion: typeof body.expectedVersion === "string" ? body.expectedVersion : undefined,
    });
    sendJson(res, result.ok ? 200 : result.reason === "conflict" ? 409 : 422, result);
  }

  async function saveLayout(view: string, body: Record<string, unknown>, res: ServerResponse) {
    if (!isViewKey(view)) throw new HttpError(404, `不明なビュー: ${view}`);
    await store.setLayout(view, (body.positions ?? {}) as Positions);
    res.writeHead(204).end();
  }

  async function decideReview(body: Record<string, unknown>, res: ServerResponse) {
    const decision = body.decision;
    if (decision !== "approved" && decision !== "rejected") throw new HttpError(400, "decision は approved か rejected です");
    const comments = (Array.isArray(body.comments) ? body.comments : []) as ReviewComment[];
    const feature = await resolveFeature(store.repoRoot);
    if (!feature) throw new HttpError(404, "feature の外ではレビューできません");
    if (isInvalidFeature(feature)) throw new HttpError(404, `レビューできません: ${feature.reason}`);
    const record = await store.exclusive(async () => {
      if (body.version !== store.version) throw new HttpError(409, "レビュー中にモデルが変更されました。最新の状態を確認してください");
      if (decision === "approved" && (store.parseError || hasErrors(validate(store.model)))) {
        throw new HttpError(422, "エラーが残っているため承認できません");
      }
      try {
        const next = decide(await readReview(feature.reviewFile), { decision, comments, hash: store.version, now: now() });
        await writeReview(feature.reviewFile, next);
        return next;
      } catch (e) {
        if (e instanceof ReviewError) throw new HttpError(422, e.message);
        throw e;
      }
    });
    reviewEvents.emit("review");
    sendJson(res, 200, { review: record });
  }

  async function serveStatic(pathname: string, res: ServerResponse) {
    if (!webRoot) {
      res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("Web UI がビルドされていません");
      return;
    }
    const root = normalize(webRoot);
    const requested = normalize(join(root, decodeURIComponent(pathname)));
    const file = requested.startsWith(root + sep) && extname(requested) ? requested : join(root, "index.html");
    try {
      const body = await readFile(file);
      res.writeHead(200, { "content-type": CONTENT_TYPES[extname(file)] ?? "application/octet-stream" }).end(body);
    } catch {
      if (file.endsWith("index.html")) {
        res.writeHead(503, { "content-type": "text/plain; charset=utf-8" }).end("Web UI がビルドされていません");
      } else {
        res.writeHead(404).end();
      }
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    if (!allowedHost(req)) throw new HttpError(403, "許可されていないホストです");
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    const method = req.method ?? "GET";
    if (method !== "GET" && req.headers["x-rdra-client"] !== "web") throw new HttpError(403, "x-rdra-client ヘッダーが必要です");

    if (method === "GET" && pathname === "/api/state") return sendJson(res, 200, await state());
    if (method === "GET" && pathname === "/api/diff") return sendJson(res, 200, await diff());
    if (method === "POST" && pathname === "/api/ops") return applyOps(await readJson(req), res);
    if (method === "PUT" && pathname.startsWith("/api/layout/")) {
      return saveLayout(pathname.slice("/api/layout/".length), await readJson(req), res);
    }
    if (method === "POST" && pathname === "/api/review/decision") return decideReview(await readJson(req), res);
    if (pathname.startsWith("/api/")) throw new HttpError(404, "見つかりません");
    if (method === "GET") return serveStatic(pathname, res);
    throw new HttpError(405, "許可されていないメソッドです");
  }

  const server = createServer((req, res) => {
    handle(req, res).catch((e: unknown) => {
      if (e instanceof HttpError) sendJson(res, e.status, { message: e.message });
      else sendJson(res, 500, { message: (e as Error).message });
    });
  });

  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = new URL(req.url ?? "/", "http://localhost");
    if (pathname !== "/ws" || !allowedHost(req)) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      sockets.add(ws);
      ws.on("error", () => {
        sockets.delete(ws);
        ws.terminate();
      });
      ws.on("close", () => sockets.delete(ws));
    });
  });

  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const { port: actualPort } = server.address() as AddressInfo;

  return {
    url: `http://127.0.0.1:${actualPort}/`,
    close: async () => {
      store.off("change", onModel);
      store.off("layout", onLayout);
      reviewEvents.off("review", onReview);
      for (const socket of sockets) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
