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

export async function rootWorktreeBranch(repoRoot: string): Promise<string | null> {
  const r = await git(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return null;
  for (const line of r.stdout.split("\n")) {
    if (line.startsWith("branch refs/heads/")) return line.slice("branch refs/heads/".length);
    if (line === "detached" || line === "") return null;
  }
  return null;
}

export function baseCommitConfigKey(branch: string): string {
  return `branch.${branch}.geass-base-commit`;
}

export async function resolveBaseCommit(repoRoot: string): Promise<string | null> {
  const branch = await currentBranch(repoRoot);
  if (branch) {
    const configured = await git(repoRoot, ["config", "--get", baseCommitConfigKey(branch)]);
    const value = configured.stdout.trim();
    if (configured.ok && value) {
      const verified = await git(repoRoot, ["rev-parse", "--verify", "--quiet", `${value}^{commit}`]);
      if (verified.ok) return verified.stdout.trim();
    }
  }
  const root = await rootWorktreeBranch(repoRoot);
  if (root && root !== branch) {
    const mb = await git(repoRoot, ["merge-base", "HEAD", root]);
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
