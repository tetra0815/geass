import { nodeVersionError } from "../node-version.js";

const versionError = nodeVersionError(process.versions.node);
if (versionError) {
  process.stderr.write(versionError + "\n");
  process.exit(1);
}
const { startServer } = await import("../server.js");
await startServer();
