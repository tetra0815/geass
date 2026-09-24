import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { repoRootOf } from "./git.js";
import { createMcpServer } from "./mcp.js";
import { QueryIndex } from "./query.js";
import { RdraStore } from "./store.js";

export async function startServer(): Promise<void> {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();
  const repoRoot = (await repoRootOf(cwd)) ?? cwd;
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const server = createMcpServer({ store, index: new QueryIndex(), reviewUrl: () => null });
  await server.connect(new StdioServerTransport());
}
