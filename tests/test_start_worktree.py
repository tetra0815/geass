import os
import subprocess
from pathlib import Path

import pytest

from conftest import PLUGIN_ROOT, git

SCRIPT = PLUGIN_ROOT / "scripts" / "start-worktree.sh"


@pytest.fixture
def fake_wezterm(tmp_path: Path) -> tuple[str, Path]:
    bin_dir = tmp_path / "fakebin"
    bin_dir.mkdir()
    log = tmp_path / "wezterm.log"
    script = bin_dir / "wezterm"
    script.write_text(f'#!/bin/sh\nprintf "%s\\n" "$@" >> "{log}"\n')
    script.chmod(0o755)
    return f"{bin_dir}{os.pathsep}{os.environ['PATH']}", log


def start(cwd: Path, fake: tuple[str, Path], *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["bash", str(SCRIPT), *args], cwd=cwd, env={**os.environ, "PATH": fake[0]}, capture_output=True, text=True
    )


def lines(result: subprocess.CompletedProcess) -> dict:
    return dict(line.split(": ", 1) for line in result.stdout.strip().splitlines())


@pytest.fixture
def flow_repo(repo: Path) -> Path:
    git(repo, "branch", "develop")
    return repo


def test_feature_is_cut_from_develop_in_the_root_worktree(flow_repo: Path, fake_wezterm) -> None:
    (flow_repo / "later.txt").write_text("main moves on\n")
    git(flow_repo, "add", "-A")
    git(flow_repo, "commit", "-q", "-m", "main only")
    prompt = "/rdra 注文の'取消'を\"追加\"する"
    result = start(flow_repo, fake_wezterm, "feature", "42-order-cancel", prompt)
    assert result.returncode == 0, result.stderr
    out = lines(result)
    worktree = flow_repo / ".claude" / "worktrees" / "feature" / "42-order-cancel"
    assert out == {
        "BRANCH_NAME": "feature/42-order-cancel",
        "WORKTREE_PATH": str(worktree),
        "BASE_BRANCH": "develop",
        "START_POINT": "develop",
    }
    assert git(worktree, "rev-parse", "HEAD") == git(flow_repo, "rev-parse", "develop")
    assert git(flow_repo, "branch", "--show-current").strip() == "main"
    assert git(flow_repo, "config", "gitflow.branch.feature/42-order-cancel.base").strip() == "develop"
    assert (worktree / ".claude" / "settings.local.json").exists()
    logged = fake_wezterm[1].read_text().splitlines()
    assert logged[:3] == ["cli", "spawn", "--cwd"]
    assert str(worktree) in logged
    assert logged[-1] == prompt


def test_hotfix_is_cut_from_master(flow_repo: Path, fake_wezterm) -> None:
    result = start(flow_repo, fake_wezterm, "hotfix", "fix-timeout", "debug it")
    assert result.returncode == 0, result.stderr
    assert lines(result)["BRANCH_NAME"] == "hotfix/fix-timeout"
    assert lines(result)["BASE_BRANCH"] == "main"
    assert git(flow_repo, "config", "gitflow.branch.hotfix/fix-timeout.base").strip() == "main"


def test_prefers_origin_and_leaves_no_upstream(repo: Path, tmp_path: Path, fake_wezterm) -> None:
    git(repo, "branch", "develop")
    clone = tmp_path / "clone"
    subprocess.run(["git", "clone", "-q", str(repo), str(clone)], check=True)
    (repo / "upstream.txt").write_text("new on develop\n")
    git(repo, "checkout", "-q", "develop")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "develop moves on")
    result = start(clone, fake_wezterm, "feature", "demo", "/rdra demo")
    assert result.returncode == 0, result.stderr
    assert lines(result)["START_POINT"] == "origin/develop"
    worktree = Path(lines(result)["WORKTREE_PATH"])
    assert git(worktree, "rev-parse", "HEAD") == git(repo, "rev-parse", "develop")
    upstream = subprocess.run(["git", "rev-parse", "--abbrev-ref", "feature/demo@{u}"], cwd=clone, capture_output=True, text=True)
    assert upstream.returncode != 0


def test_runs_from_inside_a_linked_worktree(flow_repo: Path, fake_wezterm) -> None:
    first = start(flow_repo, fake_wezterm, "feature", "first", "/rdra first")
    inside = Path(lines(first)["WORKTREE_PATH"])
    second = start(inside, fake_wezterm, "feature", "second", "/rdra second")
    assert second.returncode == 0, second.stderr
    assert lines(second)["WORKTREE_PATH"] == str(flow_repo / ".claude" / "worktrees" / "feature" / "second")
    assert git(inside, "branch", "--show-current").strip() == "feature/first"


@pytest.mark.parametrize(
    "args",
    [["feature", "Bad Name", "p"], ["feature", "x"], ["release", "x", "p"], ["feature", "-x", "p"]],
)
def test_rejects_bad_arguments(flow_repo: Path, fake_wezterm, args: list) -> None:
    result = start(flow_repo, fake_wezterm, *args)
    assert result.returncode == 64
    assert git(flow_repo, "branch", "--list", "feature/*").strip() == ""


def test_fails_on_existing_branch_or_missing_base(flow_repo: Path, fake_wezterm) -> None:
    assert start(flow_repo, fake_wezterm, "feature", "dup", "p").returncode == 0
    again = start(flow_repo, fake_wezterm, "feature", "dup", "p")
    assert again.returncode == 1
    assert "already exists" in again.stderr
    git(flow_repo, "config", "gitflow.branch.develop", "nope")
    missing = start(flow_repo, fake_wezterm, "feature", "other", "p")
    assert missing.returncode == 1
    assert "nope" in missing.stderr
