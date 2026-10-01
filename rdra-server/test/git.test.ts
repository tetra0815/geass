import { mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REVIEWS_DIR, isInvalidFeature, resolveFeature } from "../src/feature.js";
import { currentBranch, gitConfig, lastCommitTouching, readModelFilesAt, repoRootOf, resolveBaseCommit } from "../src/git.js";
import { makeFeatureRepo, makeRepo, run, writeFiles } from "./helpers.js";

const head = (repo: string) => run(repo, "git", ["rev-parse", "HEAD"]).trim();

async function commitFile(repo: string, path: string) {
  await writeFiles(repo, { [path]: path });
  run(repo, "git", ["add", "-A"]);
  run(repo, "git", ["commit", "-q", "-m", path]);
}

describe("git helpers", () => {
  it("returns null outside a repository", async () => {
    const dir = await realpath(await mkdtemp(join(tmpdir(), "rdra-nogit-")));
    expect(await repoRootOf(dir)).toBeNull();
  });

  it("finds the repo root, branch and config values", async () => {
    const repo = await makeRepo();
    expect(await repoRootOf(repo)).toBe(repo);
    expect(await currentBranch(repo)).toBe("main");
    expect(await gitConfig(repo, "gitflow.prefix.feature")).toBeNull();
    run(repo, "git", ["config", "gitflow.prefix.feature", "feat/"]);
    expect(await gitConfig(repo, "gitflow.prefix.feature")).toBe("feat/");
  });

  it("reads model files at a commit and finds the last commit touching a path", async () => {
    const repo = await makeRepo({ "docs/rdra/actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await readModelFilesAt(repo, head(repo))).toEqual({ "actors.yaml": "- id: act.a\n  name: A\n" });
    expect(await lastCommitTouching(repo, "docs/rdra/actors.yaml")).toBe(head(repo));
    expect(await lastCommitTouching(repo, "nothing.txt")).toBeNull();
  });
});

describe("resolveBaseCommit", () => {
  it("uses the merge-base with the local develop branch", async () => {
    const repo = await makeFeatureRepo();
    const base = head(repo);
    await commitFile(repo, "a.txt");
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("prefers the branch's recorded git-flow base", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "release/1.0"]);
    await commitFile(repo, "r.txt");
    const releaseHead = head(repo);
    run(repo, "git", ["checkout", "-q", "-b", "feature/x"]);
    run(repo, "git", ["config", "gitflow.branch.feature/x.base", "release/1.0"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(releaseHead);
  });

  it("honors gitflow.branch.develop", async () => {
    const repo = await makeRepo();
    const base = head(repo);
    run(repo, "git", ["branch", "dev"]);
    run(repo, "git", ["config", "gitflow.branch.develop", "dev"]);
    run(repo, "git", ["checkout", "-q", "-b", "feature/x"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(base);
  });

  it("prefers origin/<base> over the local branch", async () => {
    const upstream = await makeRepo();
    run(upstream, "git", ["branch", "develop"]);
    const originBase = head(upstream);
    const repo = await realpath(await mkdtemp(join(tmpdir(), "rdra-clone-")));
    run(repo, "git", ["clone", "-q", upstream, "."]);
    run(repo, "git", ["config", "user.email", "test@example.com"]);
    run(repo, "git", ["config", "user.name", "test"]);
    run(repo, "git", ["config", "commit.gpgsign", "false"]);
    run(repo, "git", ["checkout", "-q", "-b", "develop", "origin/develop"]);
    await commitFile(repo, "local-develop.txt");
    // Cut from the local develop, which is ahead of origin/develop: the two
    // candidate merge-bases now differ, so the test tells them apart.
    run(repo, "git", ["checkout", "-q", "-b", "feature/x", "develop"]);
    await commitFile(repo, "x.txt");
    expect(await resolveBaseCommit(repo)).toBe(originBase);
  });

  it("returns null on the base branch itself or when the base does not exist", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["checkout", "-q", "-b", "develop"]);
    expect(await resolveBaseCommit(repo)).toBeNull();
    const other = await makeRepo();
    run(other, "git", ["checkout", "-q", "-b", "feature/x"]);
    expect(await resolveBaseCommit(other)).toBeNull();
  });
});

describe("resolveFeature", () => {
  it("derives the feature from a feature/ branch", async () => {
    const repo = await makeFeatureRepo({}, "42-order-cancel");
    expect(await resolveFeature(repo)).toEqual({
      id: "42-order-cancel",
      branch: "feature/42-order-cancel",
      reviewFile: join(repo, REVIEWS_DIR, "42-order-cancel.json"),
    });
  });

  it("honors gitflow.prefix.feature", async () => {
    const repo = await makeRepo();
    run(repo, "git", ["config", "gitflow.prefix.feature", "feat/"]);
    run(repo, "git", ["checkout", "-q", "-b", "feat/demo"]);
    expect(await resolveFeature(repo)).toMatchObject({ id: "demo" });
  });

  it("returns null outside a feature branch and for detached HEAD", async () => {
    const repo = await makeRepo();
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "-b", "hotfix/x"]);
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "-b", "develop"]);
    expect(await resolveFeature(repo)).toBeNull();
    run(repo, "git", ["checkout", "-q", "--detach"]);
    expect(await resolveFeature(repo)).toBeNull();
  });

  it("reports a prefixed branch whose id is invalid instead of treating it as outside", async () => {
    const repo = await makeRepo();
    for (const branch of ["feature/a/b", "feature/_x"]) {
      run(repo, "git", ["checkout", "-q", "-b", branch]);
      const resolved = await resolveFeature(repo);
      expect(resolved).toMatchObject({ invalid: true, branch });
      expect(isInvalidFeature(resolved)).toBe(true);
      expect(resolved && "reason" in resolved ? resolved.reason : "").toContain("feature/<id>");
    }
    run(repo, "git", ["checkout", "-q", "-b", "feat/team/42-x"]);
    run(repo, "git", ["config", "gitflow.prefix.feature", "feat/"]);
    expect(await resolveFeature(repo)).toMatchObject({ invalid: true, reason: expect.stringContaining("feat/<id>") });
  });
});
