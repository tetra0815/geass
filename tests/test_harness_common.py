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


def test_git_flow_config_falls_back_to_the_default(repo: Path) -> None:
    assert run_bash(repo, "git_flow_config branch.develop develop").stdout == "develop"
    git(repo, "config", "gitflow.branch.develop", "dev")
    assert run_bash(repo, "git_flow_config branch.develop develop").stdout == "dev"


def test_terminal_multiplexer_defaults_to_wezterm(repo: Path) -> None:
    assert run_bash(repo, 'terminal_multiplexer "$PWD"').stdout == "wezterm"
    write_json(repo / ".geass" / "init-options.json", {"terminal_multiplexer": "tmux"})
    assert run_bash(repo, 'terminal_multiplexer "$PWD"').stdout == "tmux"


def test_removed_helpers_are_gone(repo: Path) -> None:
    for name in ["feature_handoff_command", "record_base_commit", "require_root_branch", "generate_slug_name"]:
        assert run_bash(repo, f"type {name}").returncode != 0, name
