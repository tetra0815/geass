import subprocess
from pathlib import Path

from conftest import PLUGIN_ROOT, git, write_json


def run_bash(repo: Path, script: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", "-c", f'source "{PLUGIN_ROOT}/scripts/harness-common.sh"; {script}'],
        cwd=repo,
        capture_output=True,
        text=True,
    )


def test_handoff_defaults_to_design_spec(repo: Path) -> None:
    assert run_bash(repo, 'feature_handoff_command "$PWD"').stdout == "/design-spec"


def test_handoff_is_rdra_when_approval_is_required(repo: Path) -> None:
    write_json(repo / ".geass" / "init-options.json", {"require_rdra_approval": True})
    assert run_bash(repo, 'feature_handoff_command "$PWD"').stdout == "/rdra"


def test_handoff_stays_design_spec_when_explicitly_disabled(repo: Path) -> None:
    write_json(repo / ".geass" / "init-options.json", {"require_rdra_approval": False})
    assert run_bash(repo, 'feature_handoff_command "$PWD"').stdout == "/design-spec"


def test_record_base_commit_writes_branch_config(repo: Path) -> None:
    head = git(repo, "rev-parse", "HEAD").strip()
    result = run_bash(repo, f'record_base_commit "$PWD" 20260925-120000-demo {head}')
    assert result.returncode == 0, result.stderr
    assert git(repo, "config", "--get", "branch.20260925-120000-demo.geass-base-commit").strip() == head
