import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { beforeAll, describe, expect, it } from "vitest";
import { makeRepo } from "./helpers.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dist = (f: string) => join(root, "dist", f);

beforeAll(() => {
  execFileSync("node", ["build.mjs"], { cwd: root, stdio: "ignore" });
}, 60_000);

describe("built bundles", () => {
  it("produces server.js, cli.js and the web app", () => {
    expect(existsSync(dist("server.js"))).toBe(true);
    expect(existsSync(dist("cli.js"))).toBe(true);
    expect(existsSync(dist("web/index.html"))).toBe(true);
  });

  it("serves the web app and API from the CLI", async () => {
    const repo = await makeRepo();
    const child = spawn("node", [dist("cli.js"), "serve", "--repo", repo], { stdio: ["ignore", "pipe", "ignore"] });
    try {
      const url = await new Promise<string>((resolve) => child.stdout!.once("data", (c) => resolve(JSON.parse(String(c)).url)));
      expect((await fetch(url)).headers.get("content-type")).toContain("text/html");
      expect((await fetch(new URL("api/state", url))).status).toBe(200);
    } finally {
      child.kill("SIGTERM");
    }
  }, 20_000);

  it("serves MCP tools over stdio", async () => {
    const repo = await makeRepo();
    const transport = new StdioClientTransport({ command: "node", args: [dist("server.js")], cwd: repo, stderr: "ignore" });
    const client = new Client({ name: "test", version: "0" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map((t) => t.name);
      expect(names).toContain("rdra_get_model");
    } finally {
      await client.close();
    }
  }, 20_000);

  it("runs the CLI", async () => {
    const repo = await makeRepo();
    const res = spawnSync("node", [dist("cli.js"), "hash", "--repo", repo], { encoding: "utf8" });
    expect(res.status).toBe(0);
    expect(res.stdout).toMatch(/^sha256:/);
    expect(spawnSync("node", [dist("cli.js"), "nope"], { encoding: "utf8" }).status).toBe(64);
  });
});
