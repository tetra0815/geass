import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { resolveFeatureDir } from "../src/feature.js";
import {
  baseCommitConfigKey,
  currentBranch,
  lastCommitTouching,
  readModelFilesAt,
  repoRootOf,
  resolveBaseCommit,
  rootWorktreeBranch,
} from "../src/git.js";
import { makeRepo, run, writeFiles } from "./helpers.js";

describe("git helpers", () => {
  it("returns null outside a repository", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-nogit-")));
    expect(await repoRootOf(dir)).toBeNull();
  });

  it("finds the repo root and branches", async () => {
    const repo = await makeRepo();
    expect(await repoRootOf(join(repo))).toBe(repo);
    expect(await currentBranch(repo)).toBe("main");
    expect(await rootWorktreeBranch(repo)).toBe("main");
  });

  it("prefers the recorded base commit", async () => {
    const repo = await makeRepo();
    const base = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    await writeFiles(repo, { "a.txt": "a" });
    run(repo, "git", ["add", "-A"]);
    run(repo, "git", ["commit", "-q", "-m", "work"]);
    run(repo, "git", ["config", baseCommitConfigKey("20260925-120000-demo"), base]);
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("falls back to merge-base with the root worktree branch", async () => {
    const repo = await makeRepo();
    const base = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    const wt = join(repo, ".wt");
    run(repo, "git", ["worktree", "add", "-q", "-b", "feat", wt]);
    await writeFiles(wt, { "b.txt": "b" });
    run(wt, "git", ["add", "-A"]);
    run(wt, "git", ["commit", "-q", "-m", "feat work"]);
    expect(await resolveBaseCommit(wt)).toBe(base);
  });

  it("returns null when there is nothing to compare against", async () => {
    const repo = await makeRepo();
    expect(await resolveBaseCommit(repo)).toBeNull();
  });

  it("reads model files at a commit and finds the last commit touching a path", async () => {
    const repo = await makeRepo({ "docs/rdra/actors.yaml": "- id: act.a\n  name: A\n" });
    const head = run(repo, "git", ["rev-parse", "HEAD"]).trim();
    expect(await readModelFilesAt(repo, head)).toEqual({ "actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await lastCommitTouching(repo, "docs/rdra/actors.yaml")).toBe(head);
    expect(await lastCommitTouching(repo, "nothing.txt")).toBeNull();
  });
});

describe("resolveFeatureDir", () => {
  it("uses the environment variable first", async () => {
    const repo = await makeRepo();
    expect(await resolveFeatureDir(repo, { SPECIFY_FEATURE_DIRECTORY: "specs/x" })).toBe(join(repo, "specs/x"));
  });

  it("uses .geass/feature.json next", async () => {
    const repo = await makeRepo({ ".geass/feature.json": '{"feature_directory":"specs/001-demo"}' });
    expect(await resolveFeatureDir(repo, {})).toBe(join(repo, "specs/001-demo"));
  });

  it("derives the directory from a feature branch name", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "20260925-120000-demo"]);
    expect(await resolveFeatureDir(repo, {})).toBe(join(repo, "specs/20260925-120000-demo"));
  });

  it("returns null on a non-feature branch", async () => {
    const repo = await makeRepo();
    expect(await resolveFeatureDir(repo, {})).toBeNull();
  });
});
