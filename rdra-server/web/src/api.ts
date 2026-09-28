import type { ElementChange } from "../../src/diff.js";
import type { Model } from "../../src/model/kinds.js";
import type { Layout, Positions, ViewKey } from "../../src/model/view-keys.js";
import type { Operation } from "../../src/operations.js";
import type { ReviewComment, ReviewRecord } from "../../src/review.js";
import type { ApplyResult } from "../../src/store.js";
import type { Issue } from "../../src/validate.js";

export interface AppState {
  version: string;
  parseError: string | null;
  model: Model;
  issues: Issue[];
  layout: Layout;
  feature: string | null;
  review: ReviewRecord | null;
  approval: "none" | "pending" | "rejected" | "approved" | "stale";
}

export interface DiffState {
  base: string | null;
  changes: ElementChange[];
  note?: string;
}

export interface Response<T> {
  status: number;
  data: T;
}

async function send<T>(method: string, path: string, body: unknown): Promise<Response<T>> {
  const res = await fetch(path, {
    method,
    headers: { "content-type": "application/json", "x-rdra-client": "web" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  return { status: res.status, data: (text ? JSON.parse(text) : null) as T };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path, { cache: "no-store" });
  if (!res.ok) throw new Error(`${path}: ${res.status}`);
  return (await res.json()) as T;
}

export const api = {
  state: () => get<AppState>("api/state"),
  diff: () => get<DiffState>("api/diff"),
  apply: (expectedVersion: string, ops: Operation[]) => send<ApplyResult>("POST", "api/ops", { expectedVersion, ops }),
  saveLayout: (view: ViewKey, positions: Positions) => send<null>("PUT", `api/layout/${view}`, { positions }),
  decide: (decision: "approved" | "rejected", comments: ReviewComment[], version: string) =>
    send<{ review?: ReviewRecord; message?: string }>("POST", "api/review/decision", { decision, comments, version }),
};

export function subscribe(onMessage: (message: { type: string }) => void): () => void {
  let socket: WebSocket | null = null;
  let closed = false;
  const connect = () => {
    const url = new URL("ws", location.href);
    url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
    socket = new WebSocket(url);
    socket.onmessage = (event) => onMessage(JSON.parse(String(event.data)) as { type: string });
    socket.onclose = () => {
      if (!closed) setTimeout(connect, 1000);
    };
  };
  connect();
  return () => {
    closed = true;
    socket?.close();
  };
}
