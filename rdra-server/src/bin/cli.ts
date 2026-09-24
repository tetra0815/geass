import { nodeVersionError } from "../node-version.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  process.stdout.write(JSON.stringify({ state: "error", message: versionError }) + "\n");
  process.exit(3);
}
const { runCli } = await import("../cli.js");
process.exitCode = await runCli(process.argv.slice(2));
