#!/usr/bin/env python3
"""PreToolUse gate for the geass worktree harness.

Blocks Skill invocations that need a precondition geass itself does not
otherwise enforce:

  - git-feature: root worktree must be on a <git-flow release
    prefix>* branch (git config gitflow.prefix.release, default "release/").
  - git-hotfix: root worktree must be on the git-flow master branch
    (git config gitflow.branch.master, default "main").
  - plan: requires spec.md to already have a '## Clarifications'
    section (i.e. clarify ran first). Optional -- controlled by
    enforce_clarify_before_plan in .geass/init-options.json (default true).
  - superpowers:executing-plans / superpowers:subagent-driven-development:
    requires an analyze marker for the current feature (written by
    posttooluse_analyze_marker.py). Optional -- controlled by
    require_analyze_before_execute in .geass/init-options.json (default
    true).

The plan/executing-plans checks are a no-op outside a geass feature
context (check-prerequisites.sh fails), so they never block work unrelated to
the geass spec pipeline.
"""
import json
import os
import subprocess
import sys

GATED_SKILLS = {
    "git-feature",
    "git-hotfix",
    "plan",
    "executing-plans",
    "subagent-driven-development",
}


def deny(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def read_init_option_bool(repo_root: str, key: str, default: bool) -> bool:
    f = os.path.join(repo_root, ".geass", "init-options.json")
    if not os.path.isfile(f):
        return default
    try:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return default
    val = data.get(key)
    return val if isinstance(val, bool) else default


def resolve_feature_paths(repo_root: str):
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    prereq = os.path.join(plugin_root, "scripts", "bash", "check-prerequisites.sh")
    try:
        result = subprocess.run(
            [prereq, "--paths-only", "--json"],
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
    except OSError:
        # check-prerequisites.sh isn't resolvable (e.g. CLAUDE_PLUGIN_ROOT is
        # unset, or this repo has no .geass/ feature context yet) -- nothing
        # to gate.
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def root_worktree_branch(repo_root: str):
    """Return the branch name checked out in the main worktree, or None if
    detached/unknown. `git worktree list` always lists the main worktree first,
    regardless of which worktree this hook is invoked from."""
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        return None
    lines = result.stdout.splitlines()
    for i, line in enumerate(lines):
        if not line.startswith("worktree "):
            continue
        for follow in lines[i + 1:]:
            if follow.startswith("worktree "):
                break
            if follow.startswith("branch refs/heads/"):
                return follow[len("branch refs/heads/"):]
            if follow == "detached":
                return None
        return None
    return None


def git_flow_release_prefix(repo_root: str) -> str:
    result = subprocess.run(
        ["git", "config", "gitflow.prefix.release"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    prefix = result.stdout.strip()
    return prefix if result.returncode == 0 and prefix else "release/"


def git_flow_master_branch(repo_root: str) -> str:
    """Return the configured git-flow master branch name, defaulting to
    'main' if gitflow.branch.master is unset."""
    result = subprocess.run(
        ["git", "config", "gitflow.branch.master"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    branch = result.stdout.strip()
    return branch if result.returncode == 0 and branch else "main"


def main() -> int:
    data = json.load(sys.stdin)
    if data.get("tool_name") != "Skill":
        return 0

    skill = data.get("tool_input", {}).get("skill", "")
    if skill not in GATED_SKILLS:
        return 0

    repo_root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip() or os.getcwd()

    if skill == "git-feature":
        branch = root_worktree_branch(repo_root)
        prefix = git_flow_release_prefix(repo_root)
        if not branch or not branch.startswith(prefix):
            print(json.dumps(deny(
                f"ルートworktreeが {prefix}* ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/git-feature の前に、ルートworktreeで "
                "`git flow release start <version>` を実行してください。"
            )))
        return 0

    if skill == "git-hotfix":
        branch = root_worktree_branch(repo_root)
        master_branch = git_flow_master_branch(repo_root)
        if branch != master_branch:
            print(json.dumps(deny(
                f"ルートworktreeが {master_branch} ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/git-hotfix の前に、ルートworktreeで "
                f"`git checkout {master_branch}` を実行してください。"
            )))
        return 0

    paths = resolve_feature_paths(repo_root)
    if paths is None:
        # Not currently inside a geass feature context -- nothing to gate.
        return 0

    if skill == "plan":
        if not read_init_option_bool(repo_root, "enforce_clarify_before_plan", True):
            return 0
        spec = paths.get("FEATURE_SPEC", "")
        if not spec or not os.path.isfile(spec):
            print(json.dumps(deny(
                "spec.md not found for the current feature. Run /specify first."
            )))
            return 0
        with open(spec, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        if "## Clarifications" not in content:
            print(json.dumps(deny(
                "spec.md has no '## Clarifications' section yet. "
                "Run /clarify before /plan."
            )))
        return 0

    # executing-plans / subagent-driven-development
    if not read_init_option_bool(repo_root, "require_analyze_before_execute", True):
        return 0
    feature_dir = paths.get("FEATURE_DIR", "")
    if not feature_dir:
        return 0
    marker = os.path.join(repo_root, ".geass", "state", os.path.basename(feature_dir) + ".analyzed")
    if not os.path.isfile(marker):
        print(json.dumps(deny(
            f"analyze has not been run for this feature yet. "
            f"Run /analyze before {skill}."
        )))
    return 0


if __name__ == "__main__":
    sys.exit(main())
