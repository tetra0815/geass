import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";

await esbuild({
  entryPoints: { server: "src/bin/server.ts", cli: "src/bin/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["bufferutil", "utf-8-validate"],
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});

await viteBuild({ configFile: "vite.config.ts", logLevel: "warn" });
