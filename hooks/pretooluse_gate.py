#!/usr/bin/env python3
"""PreToolUse gate for the geass worktree harness.

Blocks Skill invocations that need a precondition geass itself does not
otherwise enforce:

  - feature-start: root worktree must be on a <git-flow release
    prefix>* branch (git config gitflow.prefix.release, default "release/").
  - fix-start: root worktree must be on the git-flow master branch
    (git config gitflow.branch.master, default "main") OR a <git-flow
    release prefix>* branch -- a bugfix may legitimately start from either.
  - superpowers:executing-plans / superpowers:subagent-driven-development:
    requires an analyze marker for the current feature (written by
    posttooluse_analyze_marker.py). Optional -- controlled by
    require_analyze_before_execute in .geass/init-options.json (default
    true).
  - design-spec / specify / plan / tasks / implement / executing-plans /
    subagent-driven-development: when require_rdra_approval is true in
    .geass/init-options.json (default false), the feature's RDRA model must
    be approved and unchanged since approval, as reported by
    `rdra-server/dist/cli.js check-approval`.
  - Edit / Write / MultiEdit on an rdra-review.json: denied when
    require_rdra_approval is true, so approvals only come from the review UI.

The feature-context checks are a no-op outside a geass feature context
(check-prerequisites.sh fails), so they never block work unrelated to the
geass spec pipeline.
"""
import json
import os
import subprocess
import sys

EXECUTION_SKILLS = {"executing-plans", "subagent-driven-development"}
RDRA_GATED_SKILLS = {"design-spec", "specify", "plan", "tasks", "implement"} | EXECUTION_SKILLS
GATED_SKILLS = {"feature-start", "fix-start"} | RDRA_GATED_SKILLS
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
REVIEW_FILE = "rdra-review.json"


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


def rdra_approval_problem(repo_root: str, feature_dir: str):
    """Return a deny reason if the feature's RDRA model is not approved, or
    None if it is. Any failure to run the check is itself a reason to deny:
    an approval that cannot be verified must not be treated as granted."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    cli = os.path.join(plugin_root, "rdra-server", "dist", "cli.js")
    try:
        result = subprocess.run(
            ["node", cli, "check-approval", "--repo", repo_root, "--feature-dir", feature_dir],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"RDRA の承認状態を確認できません（Node 22.13 以上が必要です）: {e}"
    if result.returncode == 0:
        return None
    lines = result.stdout.strip().splitlines()
    try:
        data = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        data = {}
    message = data.get("message") or (
        "RDRA の承認状態を確認できません: " + (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")
    )
    changed = data.get("changed")
    if changed:
        message += " 変更された要素: " + ", ".join(changed)
    return message


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


def repo_root_of_cwd() -> str:
    return subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip() or os.getcwd()


def main() -> int:
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name")

    if tool_name in EDIT_TOOLS:
        path = data.get("tool_input", {}).get("file_path", "")
        if os.path.basename(path) == REVIEW_FILE and read_init_option_bool(
            repo_root_of_cwd(), "require_rdra_approval", False
        ):
            print(json.dumps(deny(
                f"{REVIEW_FILE} はレビュー画面からのみ更新できます。"
                "承認・差し戻しは人間がレビュー画面で行ってください。"
            )))
        return 0

    if tool_name != "Skill":
        return 0

    skill = data.get("tool_input", {}).get("skill", "")
    # Plugin skills may be passed either bare ("plan") or namespaced
    # ("geass:plan") -- match on the unqualified name either way rather than
    # assume one form, since a mismatch here would make the gate a silent
    # no-op.
    if ":" in skill:
        skill = skill.rsplit(":", 1)[-1]
    if skill not in GATED_SKILLS:
        return 0

    repo_root = repo_root_of_cwd()

    if skill == "feature-start":
        branch = root_worktree_branch(repo_root)
        prefix = git_flow_release_prefix(repo_root)
        if not branch or not branch.startswith(prefix):
            print(json.dumps(deny(
                f"ルートworktreeが {prefix}* ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/feature-start の前に、ルートworktreeで "
                "`git flow release start <version>` を実行してください。"
            )))
        return 0

    if skill == "fix-start":
        branch = root_worktree_branch(repo_root)
        master_branch = git_flow_master_branch(repo_root)
        prefix = git_flow_release_prefix(repo_root)
        if not branch or not (branch == master_branch or branch.startswith(prefix)):
            print(json.dumps(deny(
                f"ルートworktreeが {master_branch} または {prefix}* ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/fix-start の前に、ルートworktreeで "
                f"`git checkout {master_branch}` または "
                "`git flow release start <version>` を実行してください。"
            )))
        return 0

    paths = resolve_feature_paths(repo_root)
    if paths is None:
        # Not currently inside a geass feature context -- nothing to gate.
        return 0

    feature_dir = paths.get("FEATURE_DIR", "")
    if not feature_dir:
        return 0

    if skill in RDRA_GATED_SKILLS and read_init_option_bool(repo_root, "require_rdra_approval", False):
        problem = rdra_approval_problem(repo_root, feature_dir)
        if problem:
            print(json.dumps(deny(problem)))
            return 0

    if skill not in EXECUTION_SKILLS:
        return 0
    if not read_init_option_bool(repo_root, "require_analyze_before_execute", True):
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
