#!/usr/bin/env python3
"""PostToolUse companion to pretooluse_gate.py.

speckit-analyze is STRICTLY READ-ONLY (writes no files), so it leaves no
artifact the gate could check. This hook fires after every Skill call and,
when the skill was speckit-analyze, writes a marker file for the current
feature so the PreToolUse gate can confirm analyze ran before
executing-plans / subagent-driven-development.
"""
import json
import os
import subprocess
import sys


def main() -> int:
    data = json.load(sys.stdin)
    if data.get("tool_name") != "Skill":
        return 0
    if data.get("tool_input", {}).get("skill") != "speckit-analyze":
        return 0

    repo_root = subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip() or os.getcwd()

    prereq = os.path.join(repo_root, ".specify", "scripts", "bash", "check-prerequisites.sh")
    result = subprocess.run(
        [prereq, "--paths-only", "--json"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        return 0
    try:
        paths = json.loads(result.stdout)
    except json.JSONDecodeError:
        return 0

    feature_dir = paths.get("FEATURE_DIR", "")
    if not feature_dir:
        return 0

    state_dir = os.path.join(repo_root, ".specify", "state")
    os.makedirs(state_dir, exist_ok=True)
    marker = os.path.join(state_dir, os.path.basename(feature_dir) + ".analyzed")
    with open(marker, "w", encoding="utf-8") as f:
        f.write("speckit-analyze ran for this feature.\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
