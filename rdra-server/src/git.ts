import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RDRA_DIR, type FileMap } from "./model/io.js";
import { KINDS } from "./model/kinds.js";

const execFileAsync = promisify(execFile);

export async function git(cwd: string, args: string[]): Promise<{ ok: boolean; stdout: string }> {
  try {
    const { stdout } = await execFileAsync("git", args, { cwd, maxBuffer: 32 * 1024 * 1024 });
    return { ok: true, stdout };
  } catch {
    return { ok: false, stdout: "" };
  }
}

export async function repoRootOf(dir: string): Promise<string | null> {
  const r = await git(dir, ["rev-parse", "--show-toplevel"]);
  return r.ok ? r.stdout.trim() : null;
}

export async function currentBranch(repoRoot: string): Promise<string | null> {
  const r = await git(repoRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}

export async function gitConfig(repoRoot: string, key: string): Promise<string | null> {
  const r = await git(repoRoot, ["config", "--get", key]);
  const value = r.stdout.trim();
  return r.ok && value ? value : null;
}

async function verifiedCommit(repoRoot: string, ref: string): Promise<boolean> {
  return (await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`])).ok;
}

export async function resolveBaseCommit(repoRoot: string): Promise<string | null> {
  const branch = await currentBranch(repoRoot);
  if (!branch) return null;
  const base =
    (await gitConfig(repoRoot, `gitflow.branch.${branch}.base`)) ?? (await gitConfig(repoRoot, "gitflow.branch.develop")) ?? "develop";
  if (base === branch) return null;
  for (const ref of [`refs/remotes/origin/${base}`, `refs/heads/${base}`]) {
    if (!(await verifiedCommit(repoRoot, ref))) continue;
    const mb = await git(repoRoot, ["merge-base", "HEAD", ref]);
    if (mb.ok && mb.stdout.trim()) return mb.stdout.trim();
  }
  return null;
}

export async function readModelFilesAt(repoRoot: string, commit: string): Promise<FileMap> {
  const files: FileMap = {};
  for (const kind of KINDS) {
    const r = await git(repoRoot, ["show", `${commit}:${RDRA_DIR}/${kind.file}`]);
    if (r.ok) files[kind.file] = r.stdout;
  }
  return files;
}

export async function lastCommitTouching(repoRoot: string, path: string): Promise<string | null> {
  const r = await git(repoRoot, ["log", "-1", "--format=%H", "--", path]);
  return r.ok && r.stdout.trim() ? r.stdout.trim() : null;
}
