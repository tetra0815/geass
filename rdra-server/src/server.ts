import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repoRootOf } from "./git.js";
import { startHttp } from "./http.js";
import { createMcpServer } from "./mcp.js";
import { QueryIndex } from "./query.js";
import { RdraStore } from "./store.js";

export function bundledWebRoot(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "web");
}

export async function startServer(): Promise<void> {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const repoRoot = (await repoRootOf(cwd)) ?? cwd;
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const reviewEvents = new EventEmitter();
  const http = await startHttp({ store, reviewEvents, webRoot: bundledWebRoot() });
  const server = createMcpServer({
    store,
    index: new QueryIndex(),
    reviewUrl: () => http.url,
    onReviewChange: () => reviewEvents.emit("review"),
  });
  await server.connect(new StdioServerTransport());
}
