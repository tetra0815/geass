import importlib.util
import io
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from conftest import PLUGIN_ROOT, approve, git

HOOK = PLUGIN_ROOT / "hooks" / "pretooluse_gate.py"
REVIEW = Path("docs") / "rdra" / "reviews" / "001-demo.json"
DESIGN_REVIEW = Path("docs") / "design" / "reviews" / "001-demo.json"


def run_gate(
    repo: Path,
    payload: dict,
    path: str | None = None,
    plugin_root: Path = PLUGIN_ROOT,
    python: str = sys.executable,
) -> dict | None:
    env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(plugin_root)}
    if path is not None:
        env["PATH"] = path
    result = subprocess.run(
        [python, str(HOOK)], input=json.dumps(payload), cwd=repo, env=env, capture_output=True, text=True
    )
    assert result.returncode == 0, result.stderr
    return json.loads(result.stdout) if result.stdout.strip() else None


def skill(name: str) -> dict:
    return {"tool_name": "Skill", "tool_input": {"skill": name}}


def edit(path: Path, tool: str = "Write") -> dict:
    return {"tool_name": tool, "tool_input": {"file_path": str(path)}}


def denied_reason(decision: dict | None) -> str:
    assert decision is not None, "expected the gate to deny"
    output = decision["hookSpecificOutput"]
    assert output["permissionDecision"] == "deny"
    return output["permissionDecisionReason"]


def no_node_path(tmp: Path) -> str:
    tools = tmp / "bin"
    tools.mkdir()
    for tool in ["git"]:
        found = shutil.which(tool)
        if found:
            (tools / tool).symlink_to(found)
    return str(tools)


@pytest.mark.parametrize("name", ["writing-plans", "superpowers:writing-plans"])
def test_unreviewed_model_blocks_planning(feature_repo: Path, name: str) -> None:
    assert "レビューがまだ依頼されていません" in denied_reason(run_gate(feature_repo, skill(name)))


def test_approved_model_allows_planning(feature_repo: Path) -> None:
    approve(feature_repo)
    assert run_gate(feature_repo, skill("superpowers:writing-plans")) is None


@pytest.mark.parametrize("name", ["superpowers:executing-plans", "subagent-driven-development"])
def test_execution_requires_trace(feature_repo: Path, name: str) -> None:
    approve(feature_repo)
    assert "/trace" in denied_reason(run_gate(feature_repo, skill(name)))


def test_changes_after_approval_block_and_name_the_elements(feature_repo: Path) -> None:
    approve(feature_repo)
    git(feature_repo, "add", "-A")
    git(feature_repo, "commit", "-q", "-m", "approve")
    (feature_repo / "docs" / "rdra" / "screens.yaml").write_text("- id: scr.top\n  name: トップ画面\n")
    reason = denied_reason(run_gate(feature_repo, skill("superpowers:writing-plans")))
    assert "承認後に RDRA が変更されました" in reason
    assert "modified scr.top" in reason


def test_outside_a_feature_nothing_is_gated(feature_repo: Path) -> None:
    git(feature_repo, "checkout", "-q", "develop")
    assert run_gate(feature_repo, skill("superpowers:executing-plans")) is None


def test_ungated_skills_and_edits_do_not_need_node(feature_repo: Path, tmp_path: Path) -> None:
    path = no_node_path(tmp_path)
    assert run_gate(feature_repo, skill("superpowers:brainstorming"), path=path) is None
    assert run_gate(feature_repo, skill("rdra"), path=path) is None
    assert run_gate(feature_repo, edit(feature_repo / "notes.md"), path=path) is None


def test_missing_node_blocks_gated_calls(feature_repo: Path, tmp_path: Path) -> None:
    path = no_node_path(tmp_path)
    assert "Node 22.13" in denied_reason(run_gate(feature_repo, skill("superpowers:writing-plans"), path=path))
    assert "Node 22.13" in denied_reason(run_gate(feature_repo, edit(feature_repo / REVIEW), path=path))


@pytest.mark.parametrize("tool", ["Edit", "Write", "MultiEdit"])
def test_review_records_cannot_be_edited(feature_repo: Path, tool: str) -> None:
    assert "レビュー画面からのみ" in denied_reason(run_gate(feature_repo, edit(feature_repo / REVIEW, tool)))


def test_review_records_are_protected_outside_a_feature_too(feature_repo: Path) -> None:
    git(feature_repo, "checkout", "-q", "develop")
    assert "レビュー画面からのみ" in denied_reason(run_gate(feature_repo, edit(feature_repo / REVIEW)))


def test_design_review_records_cannot_be_edited(feature_repo: Path) -> None:
    assert "レビュー画面からのみ" in denied_reason(run_gate(feature_repo, edit(feature_repo / DESIGN_REVIEW)))


def test_design_changes_need_a_design_approval(feature_repo: Path) -> None:
    approve(feature_repo)
    (feature_repo / "docs" / "design").mkdir(parents=True)
    (feature_repo / "docs" / "design" / "components.yaml").write_text("- id: comp.db\n  name: DB\n  type: datastore\n")
    assert "設計のレビューがまだ依頼されていません" in denied_reason(run_gate(feature_repo, skill("superpowers:writing-plans")))


def test_unparseable_gate_output_fails_closed(feature_repo: Path, tmp_path: Path) -> None:
    fake = tmp_path / "plugin"
    (fake / "rdra-server" / "dist").mkdir(parents=True)
    (fake / "rdra-server" / "dist" / "cli.js").write_text("console.log('[1]'); process.exit(1);\n")
    reason = denied_reason(run_gate(feature_repo, skill("superpowers:writing-plans"), plugin_root=fake))
    assert "ゲートを確認できません" in reason


def test_malformed_payloads_do_not_crash(feature_repo: Path) -> None:
    assert run_gate(feature_repo, {"tool_name": "Write", "tool_input": {"file_path": 1}}) is None
    assert run_gate(feature_repo, {"tool_name": "Skill", "tool_input": {"skill": None}}) is None
    assert run_gate(feature_repo, {"tool_name": "Skill", "tool_input": "writing-plans"}) is None


def system_python_below_310() -> str | None:
    system = Path("/usr/bin/python3")
    if not system.exists():
        return None
    version = subprocess.run(
        [str(system), "-c", "import sys; print(sys.version_info[:2] < (3, 10))"], capture_output=True, text=True
    )
    return str(system) if version.stdout.strip() == "True" else None


OLD_PYTHON = system_python_below_310()


@pytest.mark.skipif(OLD_PYTHON is None, reason="no /usr/bin/python3 older than 3.10")
def test_hook_runs_on_the_system_python(feature_repo: Path) -> None:
    assert OLD_PYTHON is not None
    gated = run_gate(feature_repo, skill("superpowers:writing-plans"), python=OLD_PYTHON)
    assert "レビューがまだ依頼されていません" in denied_reason(gated)
    assert run_gate(feature_repo, skill("superpowers:brainstorming"), python=OLD_PYTHON) is None


def load_hook():
    spec = importlib.util.spec_from_file_location("pretooluse_gate", HOOK)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def run_main(module, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture, payload: dict) -> dict | None:
    monkeypatch.setattr(sys, "stdin", io.StringIO(json.dumps(payload)))
    assert module.main() == 0
    out = capsys.readouterr().out
    return json.loads(out) if out.strip() else None


def test_unexpected_errors_on_gated_calls_deny(
    feature_repo: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture
) -> None:
    module = load_hook()

    def broken(args: list) -> None:
        raise RuntimeError("boom")

    monkeypatch.setattr(module, "gate_problem", broken)
    monkeypatch.chdir(feature_repo)
    reason = denied_reason(run_main(module, monkeypatch, capsys, skill("superpowers:writing-plans")))
    assert "ゲートを確認できません" in reason and "boom" in reason
    assert "boom" in denied_reason(run_main(module, monkeypatch, capsys, edit(feature_repo / REVIEW)))
    assert run_main(module, monkeypatch, capsys, skill("superpowers:brainstorming")) is None
    assert run_main(module, monkeypatch, capsys, edit(feature_repo / "notes.md")) is None


def test_non_object_payloads_do_not_crash(feature_repo: Path) -> None:
    assert run_gate(feature_repo, ["Skill"]) is None  # type: ignore[arg-type]
