import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import PLUGIN_ROOT, git, write_json

HOOK = PLUGIN_ROOT / "hooks" / "pretooluse_gate.py"
CLI = PLUGIN_ROOT / "rdra-server" / "dist" / "cli.js"
FEATURE = "specs/001-demo"


def run_gate(repo: Path, payload: dict, path: str | None = None) -> dict | None:
    env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(PLUGIN_ROOT)}
    if path is not None:
        env["PATH"] = path
    result = subprocess.run(
        [sys.executable, str(HOOK)], input=json.dumps(payload), cwd=repo, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout) if result.stdout.strip() else None


def skill(name: str) -> dict:
    return {"tool_name": "Skill", "tool_input": {"skill": name}}


def denied_reason(decision: dict | None) -> str:
    assert decision is not None, "expected the gate to deny"
    output = decision["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    return output["permissionDecisionReason"]


@pytest.fixture
def feature_repo(repo: Path) -> Path:
    (repo / "docs" / "rdra").mkdir(parents=True)
    (repo / "docs" / "rdra" / "screens.yaml").write_text("- id: scr.top\n  name: トップ\n")
    write_json(repo / ".geass" / "feature.json", {"feature_directory": FEATURE})
    write_json(repo / ".geass" / "init-options.json", {"require_rdra_approval": True})
    return repo


def model_hash(repo: Path) -> str:
    return subprocess.run(["node", str(CLI), "hash", "--repo", str(repo)], capture_output=True, text=True, check=True).stdout.strip()


def approve(repo: Path) -> None:
    write_json(
        repo / FEATURE / "rdra-review.json",
        {
            "status": "approved",
            "base_commit": None,
            "approved_hash": model_hash(repo),
            "requested_at": "t",
            "decided_at": "t",
            "rounds": [],
        },
    )


def test_disabled_projects_are_not_gated(feature_repo: Path) -> None:
    write_json(feature_repo / ".geass" / "init-options.json", {})
    assert run_gate(feature_repo, skill("specify")) is None


def test_unreviewed_model_blocks_downstream_skills(feature_repo: Path) -> None:
    for name in ["design-spec", "specify", "geass:plan", "tasks", "implement"]:
        assert "レビューがまだ依頼されていません" in denied_reason(run_gate(feature_repo, skill(name)))


def test_approved_model_passes(feature_repo: Path) -> None:
    approve(feature_repo)
    assert run_gate(feature_repo, skill("specify")) is None


def test_changes_after_approval_block_and_name_the_elements(feature_repo: Path) -> None:
    approve(feature_repo)
    git(feature_repo, "add", "-A")
    git(feature_repo, "commit", "-q", "-m", "approve")
    (feature_repo / "docs" / "rdra" / "screens.yaml").write_text("- id: scr.top\n  name: トップ画面\n")
    reason = denied_reason(run_gate(feature_repo, skill("plan")))
    assert "承認後に RDRA が変更されました" in reason
    assert "modified scr.top" in reason


def test_outside_a_feature_nothing_is_gated(feature_repo: Path) -> None:
    (feature_repo / ".geass" / "feature.json").unlink()
    assert run_gate(feature_repo, skill("specify")) is None


def test_missing_node_blocks_instead_of_passing(feature_repo: Path) -> None:
    tools = feature_repo.parent / "bin"
    tools.mkdir()
    for tool in ["git", "bash", "python3", "dirname", "basename", "cat", "grep", "sed", "head", "tr", "pwd"]:
        found = shutil.which(tool)
        if found:
            (tools / tool).symlink_to(found)
    if shutil.which("node", path=str(tools)):
        pytest.skip("node is reachable from the minimal PATH")
    assert "Node 22.13" in denied_reason(run_gate(feature_repo, skill("specify"), path=str(tools)))


def test_execution_skills_still_require_analyze(feature_repo: Path) -> None:
    approve(feature_repo)
    assert "analyze" in denied_reason(run_gate(feature_repo, skill("subagent-driven-development")))
    (feature_repo / ".geass" / "state").mkdir(parents=True)
    (feature_repo / ".geass" / "state" / "001-demo.analyzed").write_text("")
    assert run_gate(feature_repo, skill("subagent-driven-development")) is None


@pytest.mark.parametrize("tool", ["Edit", "Write", "MultiEdit"])
def test_review_file_cannot_be_edited_when_enabled(feature_repo: Path, tool: str) -> None:
    payload = {"tool_name": tool, "tool_input": {"file_path": str(feature_repo / FEATURE / "rdra-review.json")}}
    assert "レビュー画面からのみ" in denied_reason(run_gate(feature_repo, payload))


def test_other_files_and_disabled_projects_can_be_edited(feature_repo: Path) -> None:
    other = {"tool_name": "Write", "tool_input": {"file_path": str(feature_repo / "notes.md")}}
    assert run_gate(feature_repo, other) is None
    write_json(feature_repo / ".geass" / "init-options.json", {})
    review = {"tool_name": "Write", "tool_input": {"file_path": str(feature_repo / FEATURE / "rdra-review.json")}}
    assert run_gate(feature_repo, review) is None
