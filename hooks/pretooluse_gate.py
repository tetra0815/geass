#!/usr/bin/env python3
"""PreToolUse gate for geass.

Every decision is made by `rdra-server/dist/cli.js gate` (rdra-server/src/
gate.ts), so the feature, RDRA-approval and trace rules live in one place.
This hook only picks the tool calls that need a decision:

  - Skill superpowers:writing-plans / executing-plans /
    subagent-driven-development (namespaced or bare) on a feature branch.
  - Edit / Write / MultiEdit of a file under docs/rdra/reviews/ (review
    records are written only by the review UI).

Everything else passes without starting node. A gated call whose decision
cannot be obtained is denied: an approval that cannot be verified must not
be treated as granted.
"""
import json
import os
import subprocess
import sys

GATED_SKILLS = {"writing-plans", "executing-plans", "subagent-driven-development"}
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
REVIEWS_SEGMENT = "/docs/rdra/reviews/"


def deny(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def repo_root_of_cwd() -> str:
    try:
        out = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True).stdout.strip()
    except OSError:
        out = ""
    return out or os.getcwd()


def gate_problem(args: list) -> str | None:
    """Return a deny reason, or None when the gate allows the call."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    cli = os.path.join(plugin_root, "rdra-server", "dist", "cli.js")
    root = repo_root_of_cwd()
    try:
        result = subprocess.run(
            ["node", cli, "gate", "--repo", root, *args],
            capture_output=True,
            text=True,
            cwd=root,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"geass のゲートを確認できません（Node 22.13 以上が必要です）: {e}"
    if result.returncode == 0:
        return None
    unverifiable = "geass のゲートを確認できません: " + (
        result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}"
    )
    lines = result.stdout.strip().splitlines()
    try:
        data = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        return unverifiable
    if isinstance(data, dict) and data.get("decision") == "deny":
        reason = data.get("reason")
        if isinstance(reason, str) and reason:
            return reason
    return unverifiable


def main() -> int:
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name")
    tool_input = data.get("tool_input")
    if not isinstance(tool_input, dict):
        return 0

    if tool_name in EDIT_TOOLS:
        path = tool_input.get("file_path")
        if not isinstance(path, str) or not path:
            return 0
        absolute = os.path.abspath(path)
        if REVIEWS_SEGMENT not in absolute.replace(os.sep, "/"):
            return 0
        problem = gate_problem(["--path", absolute])
    elif tool_name == "Skill":
        skill = tool_input.get("skill")
        if not isinstance(skill, str) or skill.rsplit(":", 1)[-1] not in GATED_SKILLS:
            return 0
        problem = gate_problem(["--skill", skill])
    else:
        return 0

    if problem:
        print(json.dumps(deny(problem)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
