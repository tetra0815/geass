import json
import subprocess
from pathlib import Path

import pytest

PLUGIN_ROOT = Path(__file__).resolve().parents[1]


def git(repo: Path, *args: str) -> str:
    return subprocess.run(["git", *args], cwd=repo, check=True, capture_output=True, text=True).stdout


@pytest.fixture
def repo(tmp_path: Path) -> Path:
    path = tmp_path / "repo"
    path.mkdir()
    git(path, "init", "-q", "-b", "main")
    git(path, "config", "user.email", "test@example.com")
    git(path, "config", "user.name", "test")
    git(path, "config", "commit.gpgsign", "false")
    (path / "README.md").write_text("test\n")
    git(path, "add", "-A")
    git(path, "commit", "-q", "-m", "init")
    return path


def write_json(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value))


CLI = PLUGIN_ROOT / "rdra-server" / "dist" / "cli.js"


@pytest.fixture
def feature_repo(repo: Path) -> Path:
    (repo / "docs" / "rdra").mkdir(parents=True)
    (repo / "docs" / "rdra" / "screens.yaml").write_text("- id: scr.top\n  name: トップ\n")
    git(repo, "add", "-A")
    git(repo, "commit", "-q", "-m", "rdra")
    git(repo, "branch", "develop")
    git(repo, "checkout", "-q", "-b", "feature/001-demo")
    return repo


def model_hash(repo: Path) -> str:
    return subprocess.run(
        ["node", str(CLI), "hash", "--repo", str(repo)], capture_output=True, text=True, check=True
    ).stdout.strip()


def approve(repo: Path) -> None:
    write_json(
        repo / "docs" / "rdra" / "reviews" / "001-demo.json",
        {
            "status": "approved",
            "approved_hash": model_hash(repo),
            "requested_at": "t",
            "decided_at": "t",
            "rounds": [],
        },
    )
