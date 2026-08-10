#!/usr/bin/env python3
"""PreToolUse gate for the speckit + superpowers pipeline (constitution.md
'Development Workflow'). Blocks two Skill invocations that speckit itself
does not enforce:

  - speckit-plan: requires spec.md to already have a '## Clarifications'
    section (i.e. speckit-clarify ran first).
  - superpowers:executing-plans / superpowers:subagent-driven-development:
    requires a speckit-analyze marker for the current feature (written by
    speckit_posttooluse_analyze_marker.py).

A no-op outside a speckit feature context (check-prerequisites.sh fails),
so it never blocks work unrelated to the speckit pipeline.
"""
import json
import os
import subprocess
import sys

GATED_SKILLS = {"speckit-plan", "executing-plans", "subagent-driven-development"}


def deny(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def resolve_feature_paths(repo_root: str):
    prereq = os.path.join(repo_root, ".specify", "scripts", "bash", "check-prerequisites.sh")
    result = subprocess.run(
        [prereq, "--paths-only", "--json"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


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

    paths = resolve_feature_paths(repo_root)
    if paths is None:
        # Not currently inside a speckit feature context (e.g. no
        # .specify/feature.json yet) -- nothing to gate.
        return 0

    if skill == "speckit-plan":
        spec = paths.get("FEATURE_SPEC", "")
        if not spec or not os.path.isfile(spec):
            print(json.dumps(deny(
                "spec.md not found for the current feature. Run speckit-specify first."
            )))
            return 0
        with open(spec, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        if "## Clarifications" not in content:
            print(json.dumps(deny(
                "spec.md has no '## Clarifications' section yet. "
                "Run speckit-clarify before speckit-plan (per constitution.md)."
            )))
        return 0

    # executing-plans / subagent-driven-development
    feature_dir = paths.get("FEATURE_DIR", "")
    if not feature_dir:
        return 0
    marker = os.path.join(repo_root, ".specify", "state", os.path.basename(feature_dir) + ".analyzed")
    if not os.path.isfile(marker):
        print(json.dumps(deny(
            f"speckit-analyze has not been run for this feature yet. "
            f"Run speckit-analyze before {skill} (per constitution.md)."
        )))
    return 0


if __name__ == "__main__":
    sys.exit(main())
