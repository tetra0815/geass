import { build } from "esbuild";

await build({
  entryPoints: { server: "src/bin/server.ts", cli: "src/bin/cli.ts" },
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: { js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);" },
  logLevel: "warning",
});
