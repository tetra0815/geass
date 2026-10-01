# RDRA 中心パイプライン 計画 3: スキル・フック・スクリプトの置き換え Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** geass のプラグイン部分を、RDRA（`/rdra`）・`/trace`・薄い `/feature-start` / `/fix-start`・1 本のゲートだけの構成に置き換え、spec-kit 由来のスキル・スクリプト・テンプレートを削除して 0.12.0 としてまとめる。

**Architecture:** PreToolUse フックは、ゲート対象のツール呼び出しを選び出して `rdra-server/dist/cli.js gate` に判定を委ねる薄い層になる。worktree の作成は `scripts/start-worktree.sh` に一本化し、git flow の設定（プレフィックス・develop・master・base）に従う。スキル同士は呼び合わず、`/rdra` の最後に superpowers へ進む次の一手を案内する。

**Tech Stack:** Python 3（フック、pytest）、bash（スクリプト）、Markdown（スキル）、gh CLI

**Spec:** `docs/superpowers/specs/2026-09-28-rdra-centric-pipeline-design.md`（§3、§6.2、§7、§8、§10）

**前提:** 計画 1・2 が完了し、`rdra-server/dist/cli.js` に `gate`・`trace`・`check-approval --repo`・`wait-review --repo` があること

## Global Constraints

- テストの実行: リポジトリのルートで `uv run --with pytest pytest tests`（CI と同じ）
- worktree の置き場所: `<root worktree>/.claude/worktrees/<ブランチ名>`
- feature は `origin/<develop>`（なければローカルの `<develop>`）から切る。hotfix は `<master>` から切る。`<develop>` = `git config gitflow.branch.develop`（既定値 `develop`）、`<master>` = `gitflow.branch.master`（既定値 `main`）
- プレフィックス: `gitflow.prefix.feature`（既定値 `feature/`）、`gitflow.prefix.hotfix`（既定値 `hotfix/`）
- 新しいブランチには `git config gitflow.branch.<branch>.base <基点ブランチ名>` を記録する。upstream は設定しない（`--no-track`）
- ブランチ名の `<name>` は `^[a-z0-9]+(-[a-z0-9]+)*$`（例: `42-order-cancel`）
- 残る設定は `.geass/init-options.json` の `terminal_multiplexer`（`wezterm` / `tmux`、既定値 `wezterm`）だけ
- 残るスキル: `feature-start`、`fix-start`、`rdra`、`trace`
- バージョン: 0.12.0（`plugin.json`、`rdra-server/src/version.ts`）
- 生成されるコミットやファイルに spec-kit への言及を残さない（LICENSE と CHANGELOG の移行説明を除く）

## Review Focus

- **Claude Code が Skill の名前を名前空間付き（`superpowers:writing-plans`）で渡す場合と、付けずに渡す場合**: どちらもゲートされる → Task 1 のテストで固定する
- **`node` が PATH にない環境**: ゲート対象のスキルは拒否され、ゲート対象外のスキルと通常のファイル編集は、node を呼ばずに通る → Task 1 のテストで固定する
- **root worktree 以外（既存の feature の worktree の中）から `/feature-start` を実行した場合**: 新しい worktree は root worktree の下に作られ、実行した worktree のブランチは変わらない → Task 2 のテストで固定する
- **ローカルに `develop` がなく `origin/develop` だけがあるクローン**: `origin/develop` から切られ、新しいブランチは upstream を持たない → Task 2 のテストで固定する
- **説明文に `'` や `"` を含む feature**（例: `"注文の'取消'を追加"`）: 起動プロンプトがそのまま新しいセッションに届く → Task 2 のテストで固定する（スクリプトは第 3 引数をそのまま渡す）

---

### Task 1: ゲートのフックを `cli.js gate` の薄いラッパーにする

**Files:**
- Modify: `hooks/pretooluse_gate.py`（全体を置き換え）
- Modify: `hooks/hooks.json`
- Delete: `hooks/posttooluse_analyze_marker.py`
- Modify: `tests/test_pretooluse_gate.py`（全体を置き換え）
- Modify: `tests/conftest.py`

**Interfaces:**
- Consumes: `node rdra-server/dist/cli.js gate --repo <root> (--skill <name> | --path <file>)` → 1 行の JSON `{"decision":"allow"}` / `{"decision":"deny","reason":"…"}`、exit 0 / 1
- Produces: `tests/conftest.py` の `feature_repo` fixture（`main` と `develop` が同じ初期 commit、`docs/rdra/screens.yaml` あり、`feature/001-demo` を checkout 済み）と `approve(repo)` ヘルパー

- [ ] **Step 1: conftest に feature 用の fixture を追加する**

`tests/conftest.py` の末尾に追加:

```python
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
```

- [ ] **Step 2: 失敗するテストを書く**

`tests/test_pretooluse_gate.py` を次で置き換える:

```python
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


def run_gate(repo: Path, payload: dict, path: str | None = None, plugin_root: Path = PLUGIN_ROOT) -> dict | None:
    env = {**os.environ, "CLAUDE_PLUGIN_ROOT": str(plugin_root)}
    if path is not None:
        env["PATH"] = path
    result = subprocess.run(
        [sys.executable, str(HOOK)], input=json.dumps(payload), cwd=repo, env=env, capture_output=True, text=True
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
```

- [ ] **Step 3: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_pretooluse_gate.py -q`
Expected: FAIL（旧フックは `writing-plans` をゲートしない）

- [ ] **Step 4: `hooks/pretooluse_gate.py` を置き換える**

```python
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
```

- [ ] **Step 5: `hooks/hooks.json` から PostToolUse を外し、マーカーのフックを削除する**

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Skill|Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse_gate.py\""
          }
        ]
      }
    ]
  }
}
```

```bash
git rm -q hooks/posttooluse_analyze_marker.py
```

- [ ] **Step 6: テストを実行する**

Run: `uv run --with pytest pytest tests/test_pretooluse_gate.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A hooks tests/conftest.py tests/test_pretooluse_gate.py
git commit -m "Delegate the PreToolUse gate to cli.js gate for plans, execution and review records"
```

---

### Task 2: `scripts/start-worktree.sh` に worktree の作成を一本化する

**Files:**
- Create: `scripts/start-worktree.sh`
- Modify: `scripts/harness-common.sh`（使わなくなる関数を削除し、`git_flow_config` を追加）
- Delete: `scripts/create-feature-worktree.sh`、`scripts/create-hotfix-worktree.sh`
- Modify: `tests/test_harness_common.py`（全体を置き換え）
- Create: `tests/test_start_worktree.py`

**Interfaces:**
- Produces:
  - `scripts/start-worktree.sh <feature|hotfix> <name> <prompt>`。成功すると stdout に `BRANCH_NAME: …`、`WORKTREE_PATH: …`、`BASE_BRANCH: …`、`START_POINT: …` の 4 行を出す。引数の誤りは exit 64、それ以外の失敗は exit 1（stderr にエラー）
  - `harness-common.sh`: `git_flow_config <key> <default>`（`git config gitflow.<key>` の値、なければ既定値を出力）、`get_repo_root`、`read_init_option`、`terminal_multiplexer`、`check_terminal_multiplexer`、`spawn_claude_tab`（残す）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_harness_common.py` を置き換える:

```python
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
```

`tests/test_start_worktree.py`:

```python
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_harness_common.py tests/test_start_worktree.py -q`
Expected: FAIL（`start-worktree.sh` がなく、`git_flow_config` もない）

- [ ] **Step 3: `harness-common.sh` を整理する**

`scripts/harness-common.sh` のうち、次の関数とその直前のコメントを削除する: `rdra_approval_required`、`feature_handoff_command`、`record_base_commit`、`git_flow_release_prefix`、`git_flow_master_branch`、`require_root_branch`、`pull_root_branch`、`slugify`、`generate_slug_name`。ファイル冒頭のコメントを次に置き換える:

```bash
#!/usr/bin/env bash
# Shared helpers for scripts/start-worktree.sh: locating the root worktree,
# reading .geass/init-options.json and git-flow settings, and opening a new
# claude session in a terminal tab.
```

`terminal_multiplexer` の前に追加する:

```bash
# Print git config gitflow.<key>, or <default> when it is unset.
git_flow_config() {
    local value
    value=$(git config "gitflow.$1" 2>/dev/null) || value=''
    printf '%s' "${value:-$2}"
}
```

- [ ] **Step 4: `scripts/start-worktree.sh` を作る**

```bash
#!/usr/bin/env bash
# Usage: start-worktree.sh <feature|hotfix> <name> <prompt>
#
# Cut a git-flow feature (from develop) or hotfix (from master) branch into
# its own worktree under the root worktree's .claude/worktrees/, record the
# base the way git flow does (gitflow.branch.<branch>.base), and open a new
# claude session there with <prompt>. The root worktree's own checkout is
# never touched.
set -euo pipefail

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/harness-common.sh"

usage() {
    echo "Usage: $0 <feature|hotfix> <name: lowercase-slug, e.g. 42-order-cancel> <prompt>" >&2
    exit 64
}

[[ $# -eq 3 ]] || usage
KIND="$1"
NAME="$2"
PROMPT="$3"
[[ "$NAME" =~ ^[a-z0-9]+(-[a-z0-9]+)*$ ]] || usage

REPO_ROOT=$(get_repo_root) || { echo "Error: not inside a git repository" >&2; exit 1; }
cd "$REPO_ROOT"

case "$KIND" in
    feature)
        PREFIX=$(git_flow_config prefix.feature feature/)
        BASE=$(git_flow_config branch.develop develop)
        ;;
    hotfix)
        PREFIX=$(git_flow_config prefix.hotfix hotfix/)
        BASE=$(git_flow_config branch.master main)
        ;;
    *)
        usage
        ;;
esac

BRANCH="$PREFIX$NAME"
WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/$BRANCH"

if git show-ref --verify --quiet "refs/heads/$BRANCH"; then
    echo "Error: branch '$BRANCH' already exists" >&2
    exit 1
fi
if [[ -e "$WORKTREE_PATH" ]]; then
    echo "Error: worktree path '$WORKTREE_PATH' already exists" >&2
    exit 1
fi
check_terminal_multiplexer "$REPO_ROOT" || exit 1

if git remote get-url origin >/dev/null 2>&1; then
    git fetch --quiet origin "$BASE" 2>/dev/null || true
fi
if git rev-parse --verify --quiet "refs/remotes/origin/$BASE^{commit}" >/dev/null; then
    START="origin/$BASE"
elif git rev-parse --verify --quiet "refs/heads/$BASE^{commit}" >/dev/null; then
    START="$BASE"
else
    echo "Error: base branch '$BASE' not found locally or on origin (set git config gitflow.branch.$([[ $KIND == feature ]] && echo develop || echo master))" >&2
    exit 1
fi

mkdir -p "$(dirname "$WORKTREE_PATH")"
git worktree add --quiet --no-track -b "$BRANCH" "$WORKTREE_PATH" "$START"
git config "gitflow.branch.$BRANCH.base" "$BASE"

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" <<'SETTINGSEOF'
{
  "model": "claude-sonnet-5"
}
SETTINGSEOF

spawn_claude_tab "$REPO_ROOT" "$WORKTREE_PATH" "$PROMPT"

echo "BRANCH_NAME: $BRANCH"
echo "WORKTREE_PATH: $WORKTREE_PATH"
echo "BASE_BRANCH: $BASE"
echo "START_POINT: $START"
```

`git fetch` の失敗（オフライン、base がリモートにない）は無視し、手元にある ref で続ける。

```bash
chmod +x scripts/start-worktree.sh
git rm -q scripts/create-feature-worktree.sh scripts/create-hotfix-worktree.sh
```

- [ ] **Step 5: テストを実行する**

Run: `uv run --with pytest pytest tests/test_harness_common.py tests/test_start_worktree.py -q`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add -A scripts tests/test_harness_common.py tests/test_start_worktree.py
git commit -m "Create feature and hotfix worktrees from git-flow settings with one script"
```

---

### Task 3: `/feature-start` と `/fix-start` を書き直す

**Files:**
- Modify: `skills/feature-start/SKILL.md`（全体を置き換え）
- Modify: `skills/fix-start/SKILL.md`（全体を置き換え）

**Interfaces:**
- Consumes: Task 2 の `scripts/start-worktree.sh`

- [ ] **Step 1: `skills/feature-start/SKILL.md` を置き換える**

````markdown
---
name: "feature-start"
description: "Start a feature the git-flow way: open a tracking GitHub issue, cut feature/<issue>-<slug> from develop into its own worktree, and open a new terminal tab that runs /rdra there."
argument-hint: "Describe the feature"
compatibility: "Requires git, git-flow branch settings (optional), gh for GitHub issues, and WezTerm or tmux"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

If it is empty: ERROR "No feature description provided" and stop.

## Outline

1. Make a short English slug for the feature (2-4 words, lowercase ASCII letters, digits and hyphens, e.g. `order-cancel`), whatever language the description is in. Call it `SLUG`.

2. Open a tracking issue when `origin` is a GitHub remote (`git remote get-url origin` contains `github.com`):

   ```bash
   gh issue create --title "Feature: <description>" --body-file - <<'EOF'
   <description, verbatim>
   EOF
   ```

   `gh` prints the issue URL; its last path segment is the issue number `NUMBER`. If the remote is not GitHub, or `gh` fails, continue without an issue and remember why for the report.

3. Name the branch `NAME="<NUMBER>-<SLUG>"` (just `<SLUG>` without an issue) and run, passing the prompt as one argument:

   ```bash
   PROMPT=$(cat <<'EOF'
   /rdra <description, verbatim>
   EOF
   )
   "${CLAUDE_PLUGIN_ROOT}/scripts/start-worktree.sh" feature "$NAME" "$PROMPT"
   ```

4. If the script exits non-zero, report its stderr verbatim and stop. Do not retry and do not create the branch yourself.

5. Report `BRANCH_NAME`, `WORKTREE_PATH`, `BASE_BRANCH`, `START_POINT` from the script's output and the issue URL (or why there is none).

Do not model, design or implement anything here — that happens in the new tab, starting with `/rdra`.

## Done When

- [ ] The script exited 0, or its error was reported verbatim
- [ ] An issue was created for GitHub remotes, or its absence was explained
- [ ] The branch, worktree, base and issue were reported
````

- [ ] **Step 2: `skills/fix-start/SKILL.md` を置き換える**

````markdown
---
name: "fix-start"
description: "Start a bug fix the git-flow way: cut hotfix/<slug> from the master branch into its own worktree and open a new terminal tab that investigates it with superpowers:systematic-debugging."
argument-hint: "Describe the bug"
compatibility: "Requires git, git-flow branch settings (optional), and WezTerm or tmux"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

If it is empty: ERROR "No bug description provided" and stop.

## Outline

1. Make a short English slug for the bug (2-4 words, lowercase ASCII letters, digits and hyphens, e.g. `fix-payment-timeout`). Call it `SLUG`.

2. Run, passing the prompt as one argument:

   ```bash
   PROMPT=$(cat <<'EOF'
   Use the superpowers:systematic-debugging skill to investigate and fix this bug: <description, verbatim>
   EOF
   )
   "${CLAUDE_PLUGIN_ROOT}/scripts/start-worktree.sh" hotfix "$SLUG" "$PROMPT"
   ```

3. If the script exits non-zero, report its stderr verbatim and stop.

4. Report `BRANCH_NAME`, `WORKTREE_PATH`, `BASE_BRANCH` and `START_POINT`.

Do not investigate or fix the bug here. Hotfixes do not go through `/rdra`; the RDRA gate does not apply to `hotfix/*` branches.

## Done When

- [ ] The script exited 0, or its error was reported verbatim
- [ ] The branch, worktree and base were reported
````

- [ ] **Step 3: Commit**

```bash
git add skills/feature-start/SKILL.md skills/fix-start/SKILL.md
git commit -m "Rewrite feature-start and fix-start as thin git-flow wrappers"
```

---

### Task 4: `/rdra` を書き直し、`/trace` を追加する

**Files:**
- Modify: `skills/rdra/SKILL.md`（全体を置き換え）
- Create: `skills/trace/SKILL.md`
- Create: `templates/README.md`
- Modify: `templates/testing-local-testing-template.md`（4 行目）
- Create: `tests/test_skills.py`
- Delete: `tests/test_rdra_skill.py`

**Interfaces:**
- Consumes: MCP ツール（計画 1 の `rdra_validate` の `featureIssues` を含む）、CLI の `wait-review --repo` と `trace --repo`

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_skills.py`:

```python
import re
from pathlib import Path

from conftest import PLUGIN_ROOT

SKILLS = PLUGIN_ROOT / "skills"
MCP = (PLUGIN_ROOT / "rdra-server" / "src" / "mcp.ts").read_text()
CLI = (PLUGIN_ROOT / "rdra-server" / "src" / "cli.ts").read_text()


def skill_text(name: str) -> str:
    return (SKILLS / name / "SKILL.md").read_text()


def test_rdra_skill_documents_exactly_the_registered_tools() -> None:
    registered = set(re.findall(r'registerTool\(\s*"(rdra_[a-z_]+)"', MCP))
    documented = set(re.findall(r"\b(rdra_[a-z_]+)\b", skill_text("rdra")))
    assert registered, "no tools found in mcp.ts"
    assert documented == registered


def test_there_is_no_tool_to_approve() -> None:
    assert not re.search(r"registerTool\(\s*\"rdra_(approve|reject|decide)", MCP)


def test_skills_use_existing_cli_commands_and_flags() -> None:
    for path in SKILLS.glob("*/SKILL.md"):
        text = path.read_text()
        for command in re.findall(r'cli\.js" ([a-z-]+)', text):
            assert f'command === "{command}"' in CLI, (path.name, command)
        assert "--feature-dir" not in text, path


def test_rdra_skill_covers_principles_acceptance_and_migration() -> None:
    text = skill_text("rdra")
    for needle in ["principles", "acceptance", "pr.scope", ".geass/memory/constitution.md", "Covers:", "/trace", "featureIssues"]:
        assert needle in text, needle


def test_trace_skill_runs_the_cli() -> None:
    assert 'cli.js" trace --repo' in skill_text("trace")
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_skills.py -q`
Expected: FAIL（`skills/trace/SKILL.md` がなく、rdra スキルに principles がない）

- [ ] **Step 3: `skills/rdra/SKILL.md` を置き換える**

````markdown
---
name: "rdra"
description: "Build or revise the project's RDRA model (docs/rdra) — principles, actors, usecases with acceptance criteria, screens, events, information, states — through dialogue using the rdra MCP tools, get it approved by a human in the local review UI, and hand off to superpowers for design, planning and implementation."
argument-hint: "Feature description, or review feedback to address"
compatibility: "Requires the geass plugin's rdra MCP server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# RDRA Modeling and Review

The project keeps one RDRA model for the whole system in `docs/rdra/*.yaml`. It is the single source of requirements: the project's principles (what used to be a constitution), who uses the system, its usecases and their acceptance criteria, screens, events, information and states. A feature changes that model on its `feature/<id>` branch; a human reviews the change in the local review UI and approves it (the GO signal) or sends it back with comments. Until the model is approved and unchanged, the geass gate blocks `superpowers:writing-plans`, and until `/trace` has passed it also blocks `superpowers:executing-plans` and `superpowers:subagent-driven-development`.

## User Input

```text
$ARGUMENTS
```

## Tools

All model access goes through the geass plugin's `rdra` MCP server (in Claude Code the tools appear as `mcp__plugin_geass_rdra__<name>`). Never edit `docs/rdra/*.yaml` or `docs/rdra/reviews/*.json` with file tools — the server validates every change, keeps the review UI in sync, and is the only thing allowed to write review state.

| Tool | Use |
|---|---|
| `rdra_get_model` | Read the model (optionally one kind) |
| `rdra_query` | Read-only SQL over the model, e.g. which must principles apply to a usecase (`principle_scope`), or all acceptance criteria (`acceptance`) |
| `rdra_validate` | `issues` (errors block review, warnings are shown to the reviewer) and `featureIssues` (checks on this feature's changes; they block review) |
| `rdra_diff` | Element-level changes since the feature's git-flow base; usecases also list `acceptance` changes per criterion |
| `rdra_upsert` / `rdra_delete` | Add or update elements (merge by id; `null` removes a field) / delete with cascade |
| `rdra_link` / `rdra_unlink` | Add or remove relations |
| `rdra_request_review` | Mark the model as waiting for review; returns the review UI URL |
| `rdra_review_status` | `none` / `pending` / `approved` / `rejected`, the last round's comments, and whether an approval is stale |

There is deliberately no tool to approve or reject. Approval is the human's decision, made in the review UI.

### Model reference

Kinds (`kind` for `rdra_upsert`) and id prefixes: `principles` `pr.*`, `actors` `act.*`, `externalSystems` `ext.*`, `bucs` `buc.*` (optional `business`), `usecases` `uc.*`, `screens` `scr.*`, `events` `evt.*`, `information` `inf.*` (optional `attributes`), `states` `st.*` (`states: [{id, name}]`, `transitions: [{from, to}]`). Ids are `<prefix>.<kebab-slug>` and never change when a name changes.

- A principle has `category` (`business` | `quality` | `security` | `engineering` | `technology`), `level` (`must` | `should`), optional `description` (what satisfying it means — expected for `must`), and `scope` (element ids it applies to; empty means the whole system).
- A usecase has `acceptance: [{id, given?, when, then}]`. Criterion ids are slugs unique within the usecase (`ac1`, `cancel-after-shipping`) and are referenced from elsewhere as `uc.<slug>#<id>`. Every usecase this feature adds or changes needs at least one criterion.

Relations (`relation` for `rdra_link`), always written on the source element:

| relation | from → to | notes |
|---|---|---|
| `pr.scope` | pr → act / ext / buc / uc / scr / inf / st | which elements a principle governs |
| `buc.actor`, `buc.usecase` | buc → act / uc | |
| `uc.actor`, `uc.screen`, `uc.event` | uc → act / scr / evt | |
| `uc.information` | uc → inf | `attrs.access`: `create` / `read` / `update` / `delete` |
| `uc.transition` | uc → `st.<model>:<from>-><to>` | the transition must exist in the state model |
| `evt.source`, `evt.target` | evt → act / ext | where the event comes from / goes to outside the system |
| `inf.related` | inf → inf | optional `attrs.label` |
| `st.information` | st → inf | which information the state model describes |

## Execution Flow

### Step 0: Check where you are

Run `git branch --show-current`. On a `feature/*` branch (e.g. one `/feature-start` created) this run models that feature and ends with a review. On any other branch you can still read, edit and validate the model, but `rdra_request_review` refuses — tell the user so if they ask for a review.

### Step 1: Take over an old constitution (once per project)

If `.geass/memory/constitution.md` exists and `docs/rdra/principles.yaml` does not:

1. Read the constitution and split every principle and every section rule into principle candidates: `id` (a slug of its name), `name`, `description` (the rule itself), `category` (inferred from the content: process rules such as TDD or review are `engineering`, stack choices are `technology`, performance and availability are `quality`), `level` (`MUST`, `NON-NEGOTIABLE`, `REQUIRED` → `must`; `SHOULD`, `RECOMMENDED` → `should`), and `scope: []`. Drop version lines, ratification dates and Sync Impact Reports — git history replaces them.
2. Show the candidates as one table and ask the user to confirm or correct them, one open question at a time.
3. Add the agreed principles with `rdra_upsert` (`kind: "principles"`), then `git rm .geass/memory/constitution.md`. The principles are part of this feature's change and go through the same review.

If `.geass/init-options.json` still has `require_rdra_approval`, `require_analyze_before_execute` or `feature_numbering`, tell the user once that these settings no longer do anything and can be removed (only `terminal_multiplexer` remains).

### Step 2: Pick up where the review stands

Call `rdra_review_status`.

- `rejected`: the reviewer's comments in `lastRound.comments` are the work for this run. Each comment's `target` is an element id (or `null` for the whole model). Go to Step 4 and address every comment before anything else.
- `pending`: a review is already open. Tell the user the URL and go to Step 6 to wait.
- `approved` with `approval: "approved"`: nothing to do unless the user asked for changes — go to Step 7.
- `approved` with `approval: "stale"`, or `none`: continue with Step 3.

### Step 3: Understand the current model

Call `rdra_get_model` and `rdra_diff`. Summarize for yourself what the system already has, which principles apply, and what this feature has already changed. Use `rdra_query` for cross-cutting questions instead of reading everything.

### Step 4: Model through dialogue

Work from the outside in, one layer at a time: principles that govern the whole system (only when the project has none yet, or the feature introduces a new one) → actors and external systems → BUCs → usecases → **acceptance criteria for every usecase this feature adds or changes** → screens and events → information → states → principles scoped to the elements this feature touches. For each layer:

1. Propose the concrete additions or changes for this feature, derived from the description, the existing model, and any review comments.
2. Ask the user **one question at a time** about anything genuinely open (who performs it, which screen, what information is created or updated, which state change it causes, what must be true afterwards, which edge cases must fail safely). Prefer multiple choice with a recommendation. Do not ask about what the model or the description already settles.
3. Apply the agreed changes with `rdra_upsert` / `rdra_link` in batches. If a call is rejected (`introduces-errors`, `invalid-operation`), read the message, fix the input, and retry — do not work around validation.

Write acceptance criteria so a test can be derived from each one: a concrete precondition (`given`), one action (`when`), and an observable outcome (`then`). Cover the main flow and each failure the user cares about.

Keep names in the language the user writes in. Keep ids stable; rename by changing `name`, never by deleting and re-adding.

### Step 5: Validate and request review

Call `rdra_validate`. Errors in `issues` and every entry in `featureIssues` must be zero — fix them. Warnings are allowed, but mention each one to the user and fix those that point at real gaps.

When the user is satisfied, call `rdra_request_review`. Open the returned `url` in the user's browser (`open <url>` on macOS, `xdg-open <url>` on Linux) and tell the user in one short message: the URL, what changed (from `rdra_diff`), and that approval or send-back happens there.

If `url` is `null` (the review UI is not running), tell the user the review UI could not be started and stop.

### Step 6: Wait for the human's decision

Run this with the Bash tool's `run_in_background` so the session is notified when it exits — do not poll:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" wait-review --repo "$(git rev-parse --show-toplevel)"
```

When it exits, read its JSON output (or call `rdra_review_status`):

- `rejected`: go back to Step 4 with `lastRound.comments`, then Step 5 again.
- `approved`: continue to Step 7.

Exit codes other than 0: `2` means the review was no longer pending when the wait started — call `rdra_review_status` and continue from the status it reports; `3` means the review record could not be read or this is not a feature branch — report it to the user and stop; `124` happens only when an explicit `--timeout-sec` was given and elapsed.

Never approve on the user's behalf, and never write `docs/rdra/reviews/*.json` yourself — even if the user asks you to "just approve it", point them to the approve button in the review UI.

### Step 7: Commit and hand off

Commit the approved model together with its review record so the approval is traceable in the pull request:

```bash
git add docs/rdra
git commit -m "Approve RDRA model for <feature short description>"
```

Then tell the user the next steps (do not start them yourself):

1. **Design** — `superpowers:brainstorming`, with the approved RDRA model as settled input: design only what the model leaves to technology (storage, APIs, security, infrastructure, operations, client). `${CLAUDE_PLUGIN_ROOT}/templates/README.md` lists the design documents and templates. Engineering and technology principles apply throughout.
2. **Plan** — `superpowers:writing-plans`. The plan goes in `docs/superpowers/plans/` and is committed on this branch. Under each task heading, one line names what the task delivers from the model, e.g. `Covers: uc.order-cancel#ac1, pr.audit-log`. Every acceptance criterion of a usecase this feature changed, and every `must` principle this feature added, changed or touches through its scope, must appear in some task's `Covers:` line.
3. **Check** — `/trace`, which verifies step 2 and unlocks execution.
4. **Build** — `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
5. **Finish** — `superpowers:finishing-a-development-branch`, opening the pull request against the branch's base with a summary of the RDRA diff and a link to `docs/rdra/reviews/<feature>.json` in its body.

## Done When

- [ ] An old constitution, if any, was taken over as principles and removed
- [ ] Every comment from a rejected review was addressed or explicitly discussed with the user
- [ ] `rdra_validate` reports zero errors and zero `featureIssues`
- [ ] The review was requested and the human approved it in the review UI
- [ ] `docs/rdra` (including the review record) was committed
- [ ] The next steps were given to the user
````

- [ ] **Step 4: `skills/trace/SKILL.md` を作る**

````markdown
---
name: "trace"
description: "Check that the feature's committed implementation plan covers every acceptance criterion and must principle its approved RDRA change requires (Covers: lines), and unlock plan execution when it does."
argument-hint: ""
compatibility: "Requires the geass plugin's rdra-server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# Trace the plan to the RDRA model

Run from the feature's worktree, after `superpowers:writing-plans` has committed the plan:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" trace --repo "$(git rev-parse --show-toplevel)"
```

It prints a summary and, on its last line, JSON with `required`, `covered`, `uncovered`, `unknown`, `outOfScope` and `applicable`.

## Reading the result

- **Exit 0** — every required item is covered. Execution is unlocked. Tell the user in one short message, list the `applicable` principles (engineering and technology rules that apply to every task and are not traced per task), and suggest `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
- **Exit 1** — the plan falls short:
  - `uncovered`: required items no task names. For each, say which existing task should deliver it, or that a task is missing. With the user's agreement, add it to that task's `Covers:` line (and to the task's steps if the task does not actually deliver it yet), or add a task.
  - `unknown`: `Covers:` references that are not in the model — usually a typo or a renamed criterion. Fix them.
  - `outOfScope` is only a warning (a task also touches something outside this feature's change, e.g. a regression test); mention it.
  Commit the plan and run the command again. Repeat until it exits 0.
- **Exit 2** — it could not run (not a `feature/*` branch, no base branch, no committed plan, unreadable RDRA YAML). Report the message and what to do about it.

If an uncovered item shows that the model itself is wrong (a criterion nobody wants), do not drop it from the check — the model has to change through `/rdra` and a new review.

Never write or edit `.geass/state/` yourself; only this command records a passing trace. Any later change to the plan (other than ticking checkboxes) or to the RDRA model requires running `/trace` again.
````

- [ ] **Step 5: 設計文書テンプレートの索引を作る**

`templates/README.md`:

```markdown
# 設計文書とテンプレート

RDRA モデル（`docs/rdra/`）が決めるのは「何を作るか」です。ここにある設計文書は、モデルでは決まらない「どう作るか」を書く場所です。`superpowers:brainstorming` で技術設計を詰めるときに、必要なものだけを作ってください。テンプレートは `cp "${CLAUDE_PLUGIN_ROOT}/templates/<テンプレート>" <置き場所>` で複製して使います。

| 設計文書 | 置き場所 | テンプレート | RDRA のどこから導くか |
|---|---|---|---|
| 保存先の一覧と使い分け | `docs/schema/overview.md` | なし | 情報 |
| 保存先ごとのスキーマ（RDB・ドキュメント DB） | `docs/schema/storage-<name>.md` | `schema-er-diagram-template.md` | 情報、状態モデル（状態の列と許される遷移） |
| 保存先ごとのスキーマ（DynamoDB） | `docs/schema/storage-<name>.md` | `schema-dynamodb-access-patterns-template.md` | 情報、ユースケースの情報アクセス |
| 保存先ごとのスキーマ（Redis） | `docs/schema/storage-<name>.md` | `schema-redis-key-design-template.md` | 情報 |
| イベント・メッセージの形式 | `docs/schema/data-formats.md` | `schema-data-formats-template.md` | イベント |
| REST API | `docs/api/openapi.yaml` | `api-openapi-template.yaml` | ユースケースの情報アクセス（CRUD）、アクター |
| GraphQL API | `docs/api/graphql-schema.md` | `api-appsync-graphql-template.md` | 同上 |
| 外部連携とデータの流れ | `docs/api/data-flow.md` | `api-data-flow-template.md` | イベント、外部システム |
| エラー処理 | `docs/api/error-handling.md` | `api-error-handling-template.md` | 受け入れ条件（失敗系） |
| アクセス制御 | `docs/security/access-control.md` | `security-access-control-matrix-template.md` | アクター × ユースケース × 情報アクセス、security 原則 |
| 認証・データ保護 | `docs/security/authentication.md`、`data-protection.md` | なし | security 原則 |
| デプロイ | `docs/infrastructure/deployment.md` | `infrastructure-deployment-template.md` | technology 原則 |
| ローカルでのテスト | `docs/testing/local-testing.md` | `testing-local-testing-template.md` | engineering 原則、外部システム |
| ログ | `docs/operations/logging.md` | `operations-logging-template.md` | quality・security 原則 |
| 監視 | `docs/operations/monitoring.md` | `operations-monitoring-template.md` | quality 原則 |
| 画面遷移 | `docs/client/ui-ux.md` | `client-ui-flow-template.md` | 画面、ユースケース |
| 画面ごとの設計 | `docs/client/screen-<name>.md` | `client-screen-template.md` | 画面と、その画面を使うユースケース |

設計の単位が RDRA の要素を実装するときは、見出しに RDRA の id を併記してください（例: `### 注文確認画面 (scr.order-confirm)`）。RDRA → 設計文書 → 計画のタスク → コードの対応を追えるようにするためです。

設計中に RDRA モデル自体の変更が必要だと分かったら（画面が足りない、モデルにない情報がある）、設計を止めて `/rdra` に戻ってください。承認後にモデルを変えると承認が無効になり、再レビューが必要になります。
```

`templates/testing-local-testing-template.md` の 4 行目を次に置き換える:

```markdown
**Note**: Project-wide policy such as test-type strategy (unit/integration/E2E) and coverage targets is defined as `engineering` principles in the RDRA model (`docs/rdra/principles.yaml`). This document covers only the implementation-level detail of what gets replaced when writing tests, and how.
```

- [ ] **Step 6: 古いスキルのテストを削除し、テストを実行する**

```bash
git rm -q tests/test_rdra_skill.py
```

Run: `uv run --with pytest pytest tests/test_skills.py -q`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add -A skills/rdra skills/trace templates tests
git commit -m "Rewrite /rdra around principles and acceptance criteria and add /trace"
```

---

### Task 5: spec-kit 由来のスキル・スクリプト・テンプレートを削除する

**Files:**
- Delete: `skills/{analyze,checklist,constitution,converge,design-spec,implement,plan,specify,tasks,taskstoissues}/`
- Delete: `scripts/bash/`
- Delete: `templates/{spec,plan,tasks,checklist,constitution}-template.md`
- Modify: `tests/test_skills.py`（削除を固定するテストを追加）

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_skills.py` に追加:

```python
REMOVED_COMMAND = re.compile(
    r"(?<![\w/.-])/(specify|plan|tasks|analyze|checklist|converge|constitution|implement|taskstoissues|design-spec)\b(?![-.\w])"
)
LEGACY = ["SPECIFY_FEATURE_DIRECTORY", "check-prerequisites", "scripts/bash", "feature.json", "geass-base-commit", "rdra-review.json", "extensions.yml", "spec-kit", "speckit"]


def shipped_files() -> list:
    files = [PLUGIN_ROOT / "README.md", *sorted((PLUGIN_ROOT / ".claude-plugin").glob("*.json"))]
    for folder in ["skills", "hooks", "scripts", "templates"]:
        files += sorted(p for p in (PLUGIN_ROOT / folder).rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    return files


def test_only_the_rdra_centric_skills_remain() -> None:
    assert sorted(p.name for p in SKILLS.iterdir() if p.is_dir()) == ["feature-start", "fix-start", "rdra", "trace"]


def test_spec_kit_files_are_gone() -> None:
    assert not (PLUGIN_ROOT / "scripts" / "bash").exists()
    for name in ["spec", "plan", "tasks", "checklist", "constitution"]:
        assert not (PLUGIN_ROOT / "templates" / f"{name}-template.md").exists()


def test_nothing_shipped_refers_to_the_removed_pipeline() -> None:
    for path in shipped_files():
        text = path.read_text()
        match = REMOVED_COMMAND.search(text)
        assert not match, (str(path.relative_to(PLUGIN_ROOT)), match.group(0))
        for word in LEGACY:
            assert word not in text, (str(path.relative_to(PLUGIN_ROOT)), word)
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_skills.py -q`
Expected: FAIL（古いスキルが残っている。README と plugin.json に spec-kit への言及がある）

- [ ] **Step 3: 削除する**

```bash
git rm -rq skills/analyze skills/checklist skills/constitution skills/converge skills/design-spec \
  skills/implement skills/plan skills/specify skills/tasks skills/taskstoissues
git rm -rq scripts/bash
git rm -q templates/spec-template.md templates/plan-template.md templates/tasks-template.md \
  templates/checklist-template.md templates/constitution-template.md
```

- [ ] **Step 4: 残りの参照を確認する**

Run: `uv run --with pytest pytest tests/test_skills.py -q`
Expected: `test_nothing_shipped_refers_to_the_removed_pipeline` だけが README.md と `.claude-plugin/*.json` で FAIL する（Task 6 で直す）。それ以外のファイルで失敗したら、そのファイルの記述を新しい流れに合わせて直す

- [ ] **Step 5: Commit**

```bash
git add -A skills scripts templates tests/test_skills.py
git commit -m "Remove the spec-kit derived skills, scripts and templates"
```

---

### Task 6: README・plugin 定義・CHANGELOG を 0.12.0 に更新する

**Files:**
- Modify: `README.md`（全体を置き換え）
- Modify: `.claude-plugin/plugin.json`、`.claude-plugin/marketplace.json`
- Create: `CHANGELOG.md`
- Modify: `rdra-server/src/version.ts`、`rdra-server/dist/`

- [ ] **Step 1: `README.md` を置き換える**

````markdown
# geass

RDRA-centric development harness for Claude Code.

geass keeps one RDRA (Relationship Driven Requirement Analysis) model per project as the single source of requirements — including the project's principles and each usecase's acceptance criteria — has a human approve every change to it in a local review UI, and makes sure the implementation plan covers what was approved before any code is written. Everything around that is left to standard tools: git flow for branches, `gh` for issues and pull requests, and [superpowers](https://github.com/obra/superpowers) for design, planning and implementation.

## Requirements

- git (git-flow branch settings are honored when present)
- `gh` for GitHub issues and pull requests (optional)
- WezTerm or tmux
- Node.js 22.13 or later (for the RDRA MCP server and review UI)
- The superpowers plugin

## Install

```
/plugin marketplace add tetra0815/geass
/plugin install geass@geass
```

## Flow

```
/feature-start <description>   issue + feature/<#>-<slug> from develop in its own worktree, new tab runs /rdra
/rdra                          model principles, usecases and acceptance criteria → approve in the review UI → commit
superpowers:brainstorming      technical design from the approved model (templates/README.md)
superpowers:writing-plans      plan with "Covers: uc.<id>#<ac>, pr.<id>" under each task, committed on the branch
/trace                         plan covers every required criterion and principle → execution unlocked
superpowers:subagent-driven-development / executing-plans
superpowers:finishing-a-development-branch → pull request

/fix-start <description>       hotfix/<slug> from master in its own worktree, new tab runs superpowers:systematic-debugging
```

Skills do not call each other; each one ends by telling you the next step.

## The RDRA model

`docs/rdra/*.yaml` holds principles, actors, external systems, BUCs, usecases (with acceptance criteria), screens, events, information and state models. The plugin's MCP server (`rdra`) reads, edits, validates, queries and diffs it and serves the review UI, where you see the model as five diagrams plus a principles table, with the feature's changes highlighted, and can edit it directly.

- **Principles** (`pr.*`) replace a separate constitution: each has a category (`business`, `quality`, `security`, `engineering`, `technology`), a level (`must` / `should`) and an optional scope of elements it governs.
- **Acceptance criteria** live on usecases (`given` / `when` / `then`) and are referenced as `uc.<id>#<ac>`. Every usecase a feature adds or changes needs at least one before review can be requested.
- **Approval** is recorded in `docs/rdra/reviews/<feature>.json` and committed with the model. Only the review UI writes it.

## The gate

A PreToolUse hook blocks, on `feature/*` branches:

- `superpowers:writing-plans` until the feature's RDRA change is approved and unchanged since;
- `superpowers:executing-plans` and `superpowers:subagent-driven-development` until, in addition, `/trace` has passed for the current model and plan (ticking checkboxes does not count as a change);
- edits to `docs/rdra/reviews/*.json` from file tools, on any branch.

If the gate cannot be evaluated (for example Node is missing), the gated call is denied.

## Branches

- Features are cut from `origin/<develop>` (or local `<develop>`) as `<feature prefix><issue>-<slug>`; hotfixes from `<master>` as `<hotfix prefix><slug>`. Names come from `git config gitflow.branch.develop`, `gitflow.branch.master`, `gitflow.prefix.feature` and `gitflow.prefix.hotfix` (defaults `develop`, `main`, `feature/`, `hotfix/`).
- Each branch gets a worktree at `.claude/worktrees/<branch>` under the root worktree and records its base as `gitflow.branch.<branch>.base`, which is also the base of the RDRA diff.
- Work is finished through a pull request (`git flow feature finish` is not used, because it checks out the base branch in the current worktree).

## Configuration

`.geass/init-options.json`:

| Key | Default | Meaning |
|---|---|---|
| `terminal_multiplexer` | `"wezterm"` | `"wezterm"` or `"tmux"` |

`.geass/state/` holds the local `/trace` result and ignores itself in git.

## Upgrading from 0.11

See [CHANGELOG.md](CHANGELOG.md).

## Development

The RDRA server lives in `rdra-server/` (TypeScript). Its build output in `rdra-server/dist/` is committed so the plugin works without `npm install`.

```
cd rdra-server
npm ci
npm run typecheck
npx vitest run
npx playwright test        # needs `npx playwright install chromium` once
npm run build              # rebuild dist/ before committing
```

Hook, script and skill tests: `uv run --with pytest pytest tests` from the repo root.
````

- [ ] **Step 2: plugin 定義を更新する**

`.claude-plugin/plugin.json`:

```json
{
  "name": "geass",
  "description": "RDRA-centric development harness for Claude Code: one RDRA model (principles, usecases with acceptance criteria, screens, events, information, states) as the source of requirements, human approval in a local review UI, a trace check that the implementation plan covers what was approved, and git-flow worktrees for features and hotfixes. Design, planning and implementation run on superpowers.",
  "version": "0.12.0",
  "author": {
    "name": "tetra0815"
  },
  "homepage": "https://github.com/tetra0815/geass",
  "repository": "https://github.com/tetra0815/geass",
  "license": "MIT",
  "keywords": ["rdra", "requirements", "git-flow", "worktree", "superpowers", "mcp", "wezterm", "tmux"]
}
```

`.claude-plugin/marketplace.json` の `plugins[0].description` を `"RDRA-centric development harness for Claude Code"` にする。

`rdra-server/src/version.ts`:

```ts
export const SERVER_VERSION = "0.12.0";
```

- [ ] **Step 3: `CHANGELOG.md` を作る**

```markdown
# Changelog

## 0.12.0

geass no longer carries the spec-kit pipeline. The RDRA model is the single source of requirements, and design, planning and implementation run on superpowers.

### Removed

- Skills `/specify`, `/plan`, `/tasks`, `/analyze`, `/checklist`, `/converge`, `/constitution`, `/implement`, `/taskstoissues` and `/design-spec`, the `scripts/bash/` helpers, and the spec, plan, tasks, checklist and constitution templates.
- `.geass/feature.json`, `specs/NNN-*` numbering, and the settings `require_rdra_approval`, `require_analyze_before_execute` and `feature_numbering`. RDRA approval and `/trace` are always required.
- The requirement that the root worktree be on a `release/*` branch before `/feature-start`.

### Added

- Principles (`pr.*`, `docs/rdra/principles.yaml`) and usecase acceptance criteria in the RDRA model, in the review UI, in `rdra_query` and in `rdra_diff`.
- `/trace` (`cli.js trace`): checks the plan's `Covers:` lines against the feature's RDRA change and unlocks execution.
- `scripts/start-worktree.sh`, used by `/feature-start` and `/fix-start`.

### Changed

- Features are `feature/<issue>-<slug>` branches cut from `develop`; the RDRA diff is taken against `gitflow.branch.<branch>.base`.
- Review records moved from `specs/<feature>/rdra-review.json` to `docs/rdra/reviews/<feature>.json`.
- `cli.js check-approval` and `wait-review` take only `--repo`; the feature comes from the current branch.
- The gate now covers `superpowers:writing-plans`, `executing-plans` and `subagent-driven-development`.

### Upgrading

1. Finish (merge) features that are in progress on 0.11 before upgrading; their `specs/<feature>/rdra-review.json` records are not migrated.
2. Start the next feature with `/feature-start`. The first `/rdra` run turns `.geass/memory/constitution.md` into principles with you, removes the file, and puts the principles through review with that feature.
3. Remove `require_rdra_approval`, `require_analyze_before_execute` and `feature_numbering` from `.geass/init-options.json`.
4. Existing `specs/*/spec.md`, `plan.md` and `tasks.md` stay as history; nothing reads them anymore.
```

- [ ] **Step 4: dist を再ビルドし、全テストを実行する**

```bash
(cd rdra-server && npm run typecheck && npx vitest run && npm run build && npx playwright test)
uv run --with pytest pytest tests -q
```

Expected: すべて PASS（`test_nothing_shipped_refers_to_the_removed_pipeline` も通る）

- [ ] **Step 5: Commit**

```bash
git add -A README.md CHANGELOG.md .claude-plugin rdra-server/src/version.ts rdra-server/dist
git commit -m "Release 0.12.0: RDRA-centric pipeline on git flow, gh and superpowers"
```
