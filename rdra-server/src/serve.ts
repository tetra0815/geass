import { EventEmitter } from "node:events";
import type { CliIo } from "./cli.js";
import { startHttp } from "./http.js";
import { bundledWebRoot } from "./server.js";
import { RdraStore } from "./store.js";

export async function serve(repoRoot: string, port: number, io: CliIo): Promise<number> {
  const store = await RdraStore.open(repoRoot);
  store.watch();
  const http = await startHttp({ store, reviewEvents: new EventEmitter(), webRoot: bundledWebRoot() }, port);
  io.out(JSON.stringify({ url: http.url }) + "\n");
  await new Promise<void>((resolve) => {
    process.once("SIGINT", resolve);
    process.once("SIGTERM", resolve);
  });
  await http.close();
  store.close();
  return 0;
}
