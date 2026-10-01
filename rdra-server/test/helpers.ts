import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

export function run(cwd: string, cmd: string, args: string[]): string {
  return execFileSync(cmd, args, { cwd, encoding: "utf8" });
}

export async function writeFiles(root: string, files: Record<string, string>): Promise<void> {
  for (const [path, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }
}

export async function makeRepo(files: Record<string, string> = {}): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-repo-")));
  run(dir, "git", ["init", "-q", "-b", "main"]);
  run(dir, "git", ["config", "user.email", "test@example.com"]);
  run(dir, "git", ["config", "user.name", "test"]);
  run(dir, "git", ["config", "commit.gpgsign", "false"]);
  await writeFiles(dir, { "README.md": "test\n", ...files });
  run(dir, "git", ["add", "-A"]);
  run(dir, "git", ["commit", "-q", "-m", "init"]);
  return dir;
}

/** A repo on `feature/team/42-x`: it has the feature prefix but not a valid feature id. */
export async function makeInvalidFeatureRepo(files: Record<string, string> = {}): Promise<string> {
  const dir = await makeRepo(files);
  run(dir, "git", ["branch", "develop"]);
  run(dir, "git", ["checkout", "-q", "-b", "feature/team/42-x"]);
  return dir;
}

export async function makeFeatureRepo(files: Record<string, string> = {}, id = "001-demo"): Promise<string> {
  const dir = await makeRepo(files);
  run(dir, "git", ["branch", "develop"]);
  run(dir, "git", ["checkout", "-q", "-b", `feature/${id}`]);
  return dir;
}
