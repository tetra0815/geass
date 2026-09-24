# RDRA 3/3: パイプラインへの組み込み実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `require_rdra_approval` を有効にしたプロジェクトで、新しい feature が `/rdra` から始まり、人間がレビュー画面で承認するまで `/design-spec` 以降に進めないようにする。

**Architecture:** `/feature-start` の引き継ぎ先を設定で切り替え、分岐点コミットを git config に記録する。PreToolUse ゲート（`hooks/pretooluse_gate.py`）は、有効時に計画 1/3 の `check-approval` CLI を呼んで後続スキルを止め、`rdra-review.json` へのファイル編集を拒否する。新しい `/rdra` スキルが対話でモデルを作り、レビューを依頼し、`wait-review` で人間の判断を待ち、承認されたらコミットして `/design-spec` に引き継ぐ。`/design-spec` と `/specify` は承認済みの RDRA を入力として使う。

**Tech Stack:** bash, Python 3（標準ライブラリ）, pytest（`uv run --with pytest`）, GitHub Actions

**Spec:** `docs/superpowers/specs/2026-09-25-rdra-review-gate-design.md`

**前提:** 計画 1/3 と 2/3 が完了し、`rdra-server/dist/cli.js` がコミットされていること。

**この計画の範囲:** 設計書の 3.4 章（分岐点の記録）、7 章（パイプラインへの組み込み）、7.5 章（ゲートと承認記録の保護）、10 章（README、バージョン、CI）。

## Global Constraints

- 計画 1/3 の Global Constraints をすべて引き継ぐ。
- `require_rdra_approval` のデフォルトは `false`。`false` のプロジェクトでは、ゲート、`/feature-start` の引き継ぎ先、各スキルの動作を一切変えない。
- ゲートは承認を確認できないとき（Node がない、CLI が失敗した）は拒否する。確認できないまま通さない。
- feature の外（`check-prerequisites.sh --paths-only` が失敗）では、RDRA のゲートは何もしない（既存の analyze ゲートと同じ扱い）。
- ゲートの対象スキル: `design-spec`, `specify`, `plan`, `tasks`, `implement`, `executing-plans`, `subagent-driven-development`（`geass:plan` のような名前空間付きも同じ）。
- 承認・差し戻しは人間がレビュー画面で行う。スキル文書は AI に承認させる手順を一切含めない。
- スキル文書は既存のスキルに合わせて英語で書く。ユーザーに見せるゲートのメッセージは日本語。
- テストは repo 直下の `tests/` に pytest で置き、`uv run --with pytest pytest tests` で実行する。

## ファイル構成

```
scripts/harness-common.sh           rdra_approval_required / feature_handoff_command / record_base_commit を追加
scripts/create-feature-worktree.sh  分岐点の記録と引き継ぎ先の切り替え
hooks/pretooluse_gate.py            RDRA 承認のゲートと rdra-review.json の保護
hooks/hooks.json                    Edit|Write|MultiEdit にもゲートを掛ける
skills/rdra/SKILL.md                新しい /rdra スキル
skills/feature-start/SKILL.md       引き継ぎ先と分岐点の記録を説明
skills/design-spec/SKILL.md         承認済み RDRA を入力にする
skills/specify/SKILL.md             ユーザーストーリーに RDRA のユースケース ID を付ける
README.md  .claude-plugin/plugin.json  .github/workflows/ci.yml
tests/conftest.py  tests/test_harness_common.py  tests/test_pretooluse_gate.py  tests/test_rdra_skill.py
```

---

### Task 1: 分岐点の記録と、feature の引き継ぎ先の切り替え

**Files:**
- Modify: `scripts/harness-common.sh`
- Modify: `scripts/create-feature-worktree.sh`
- Create: `tests/conftest.py`
- Test: `tests/test_harness_common.py`

**Interfaces:**
- Consumes: `read_init_option`（既存、`scripts/harness-common.sh`）
- Produces:
  - `rdra_approval_required <repo_root>`: `.geass/init-options.json` の `require_rdra_approval` が真なら成功を返す（`read_init_option` は jq なら `true`、Python なら `True` を出すので両方を受け付ける）
  - `feature_handoff_command <repo_root>`: `/rdra` または `/design-spec` を出力する
  - `record_base_commit <repo_root> <branch> <commit>`: `git config branch.<branch>.geass-base-commit <commit>` を書く（計画 1 の `resolveBaseCommit` が読む）
  - テスト用 fixture `repo`（コミット 1 つの一時 git リポジトリ）、`git(repo, *args)`、`write_json(path, value)`、`PLUGIN_ROOT`（`tests/conftest.py`）

- [ ] **Step 1: テストの土台と失敗するテストを書く**

`tests/conftest.py`:

```python
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
```

`tests/test_harness_common.py`:

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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_harness_common.py -q`
Expected: FAIL（`feature_handoff_command: command not found` などで 4 件失敗）

- [ ] **Step 3: 補助関数を追加する**

`scripts/harness-common.sh` の `# Return the configured terminal multiplexer ("wezterm" or "tmux"),` の行の直前に追加する:

```bash
# Succeed when require_rdra_approval is true in .geass/init-options.json.
# read_init_option prints jq's "true" or Python's "True" depending on which
# parser it fell through to, so accept both.
rdra_approval_required() {
    local val
    val=$(read_init_option "$1" "require_rdra_approval")
    [[ "$val" == "true" || "$val" == "True" ]]
}

# Print the skill a new feature session starts with: /rdra when RDRA
# approval is required, otherwise /design-spec.
feature_handoff_command() {
    if rdra_approval_required "$1"; then
        printf '%s' "/rdra"
    else
        printf '%s' "/design-spec"
    fi
}

# Record the commit a feature branch was cut from, so rdra-server can diff
# the RDRA model against it. Stored in git config (shared by every worktree)
# rather than .geass/feature.json, which _persist_feature_json rewrites with
# feature_directory only.
record_base_commit() {
    local repo_root="$1"
    local branch="$2"
    local commit="$3"
    git -C "$repo_root" config "branch.$branch.geass-base-commit" "$commit"
}

```

- [ ] **Step 4: create-feature-worktree.sh で使う**

`scripts/create-feature-worktree.sh` の

```bash
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" "$BASE_COMMIT"
```

の次の行に追加する:

```bash
record_base_commit "$REPO_ROOT" "$BRANCH_NAME" "$BASE_COMMIT"
```

同じファイルの

```bash
PROMPT="SPECIFY_FEATURE_DIRECTORY=$SPEC_DIR is already decided -- use it as-is, do not recompute the feature name. /design-spec $FEATURE_DESCRIPTION"
```

を次に置き換える:

```bash
HANDOFF=$(feature_handoff_command "$REPO_ROOT")
PROMPT="SPECIFY_FEATURE_DIRECTORY=$SPEC_DIR is already decided -- use it as-is, do not recompute the feature name. $HANDOFF $FEATURE_DESCRIPTION"
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `uv run --with pytest pytest tests/test_harness_common.py -q && bash -n scripts/create-feature-worktree.sh`
Expected: 4 passed、構文エラーなし

- [ ] **Step 6: コミットする**

```bash
git add scripts/harness-common.sh scripts/create-feature-worktree.sh tests/conftest.py tests/test_harness_common.py
git commit -m "Record feature base commits and hand off to /rdra when required"
```

---

### Task 2: RDRA 承認のゲートと承認記録の保護

**Files:**
- Modify: `hooks/pretooluse_gate.py`
- Modify: `hooks/hooks.json`
- Test: `tests/test_pretooluse_gate.py`

**Interfaces:**
- Consumes: `rdra-server/dist/cli.js check-approval --repo <root> --feature-dir <dir>`（計画 1 Task 12。承認済みなら 0、それ以外は標準出力の最終行に `{ state, message, changed? }`）、`rdra-server/dist/cli.js hash`（テストで使用）、`scripts/bash/check-prerequisites.sh --paths-only --json`（既存）
- Produces:
  - `rdra_approval_problem(repo_root, feature_dir) -> str | None`（拒否理由。承認済みなら `None`）
  - Skill の PreToolUse: 有効時、対象スキルを未承認・承認後の変更・確認不能で拒否。`changed` があれば「変更された要素: ...」を付ける。`executing-plans` / `subagent-driven-development` は、RDRA のあとに従来の analyze マーカーも確認する
  - Edit / Write / MultiEdit の PreToolUse: 有効時、`file_path` のファイル名が `rdra-review.json` なら拒否

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_pretooluse_gate.py`:

```python
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
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_pretooluse_gate.py -q`
Expected: 6 failed, 5 passed（未承認でも拒否されない、Edit が拒否されない、Node がないのに通る）。無効時・feature の外・承認済み・analyze の既存ゲート・他ファイルの編集の 5 件は、既存の動作のままで通る

- [ ] **Step 3: ゲートを実装する**

`hooks/pretooluse_gate.py` を次の内容に置き換える（変更点: モジュールの docstring、スキル集合の定義、`rdra_approval_problem`、`repo_root_of_cwd`、`main` 冒頭の Edit 系の処理、feature 内での RDRA 確認、analyze の確認を実行系スキルだけに限定）:

`hooks/pretooluse_gate.py`:

```python
#!/usr/bin/env python3
"""PreToolUse gate for the geass worktree harness.

Blocks Skill invocations that need a precondition geass itself does not
otherwise enforce:

  - feature-start: root worktree must be on a <git-flow release
    prefix>* branch (git config gitflow.prefix.release, default "release/").
  - fix-start: root worktree must be on the git-flow master branch
    (git config gitflow.branch.master, default "main") OR a <git-flow
    release prefix>* branch -- a bugfix may legitimately start from either.
  - superpowers:executing-plans / superpowers:subagent-driven-development:
    requires an analyze marker for the current feature (written by
    posttooluse_analyze_marker.py). Optional -- controlled by
    require_analyze_before_execute in .geass/init-options.json (default
    true).
  - design-spec / specify / plan / tasks / implement / executing-plans /
    subagent-driven-development: when require_rdra_approval is true in
    .geass/init-options.json (default false), the feature's RDRA model must
    be approved and unchanged since approval, as reported by
    `rdra-server/dist/cli.js check-approval`.
  - Edit / Write / MultiEdit on an rdra-review.json: denied when
    require_rdra_approval is true, so approvals only come from the review UI.

The feature-context checks are a no-op outside a geass feature context
(check-prerequisites.sh fails), so they never block work unrelated to the
geass spec pipeline.
"""
import json
import os
import subprocess
import sys

EXECUTION_SKILLS = {"executing-plans", "subagent-driven-development"}
RDRA_GATED_SKILLS = {"design-spec", "specify", "plan", "tasks", "implement"} | EXECUTION_SKILLS
GATED_SKILLS = {"feature-start", "fix-start"} | RDRA_GATED_SKILLS
EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}
REVIEW_FILE = "rdra-review.json"


def deny(reason: str) -> dict:
    return {
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }


def read_init_option_bool(repo_root: str, key: str, default: bool) -> bool:
    f = os.path.join(repo_root, ".geass", "init-options.json")
    if not os.path.isfile(f):
        return default
    try:
        with open(f, "r", encoding="utf-8") as fh:
            data = json.load(fh)
    except (json.JSONDecodeError, OSError):
        return default
    val = data.get(key)
    return val if isinstance(val, bool) else default


def resolve_feature_paths(repo_root: str):
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    prereq = os.path.join(plugin_root, "scripts", "bash", "check-prerequisites.sh")
    try:
        result = subprocess.run(
            [prereq, "--paths-only", "--json"],
            capture_output=True,
            text=True,
            cwd=repo_root,
        )
    except OSError:
        # check-prerequisites.sh isn't resolvable (e.g. CLAUDE_PLUGIN_ROOT is
        # unset, or this repo has no .geass/ feature context yet) -- nothing
        # to gate.
        return None
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout)
    except json.JSONDecodeError:
        return None


def rdra_approval_problem(repo_root: str, feature_dir: str):
    """Return a deny reason if the feature's RDRA model is not approved, or
    None if it is. Any failure to run the check is itself a reason to deny:
    an approval that cannot be verified must not be treated as granted."""
    plugin_root = os.environ.get("CLAUDE_PLUGIN_ROOT", "")
    cli = os.path.join(plugin_root, "rdra-server", "dist", "cli.js")
    try:
        result = subprocess.run(
            ["node", cli, "check-approval", "--repo", repo_root, "--feature-dir", feature_dir],
            capture_output=True,
            text=True,
            cwd=repo_root,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        return f"RDRA の承認状態を確認できません（Node 22.13 以上が必要です）: {e}"
    if result.returncode == 0:
        return None
    lines = result.stdout.strip().splitlines()
    try:
        data = json.loads(lines[-1]) if lines else {}
    except json.JSONDecodeError:
        data = {}
    message = data.get("message") or (
        "RDRA の承認状態を確認できません: " + (result.stderr.strip() or result.stdout.strip() or f"exit {result.returncode}")
    )
    changed = data.get("changed")
    if changed:
        message += " 変更された要素: " + ", ".join(changed)
    return message


def root_worktree_branch(repo_root: str):
    """Return the branch name checked out in the main worktree, or None if
    detached/unknown. `git worktree list` always lists the main worktree first,
    regardless of which worktree this hook is invoked from."""
    result = subprocess.run(
        ["git", "worktree", "list", "--porcelain"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    if result.returncode != 0:
        return None
    lines = result.stdout.splitlines()
    for i, line in enumerate(lines):
        if not line.startswith("worktree "):
            continue
        for follow in lines[i + 1:]:
            if follow.startswith("worktree "):
                break
            if follow.startswith("branch refs/heads/"):
                return follow[len("branch refs/heads/"):]
            if follow == "detached":
                return None
        return None
    return None


def git_flow_release_prefix(repo_root: str) -> str:
    result = subprocess.run(
        ["git", "config", "gitflow.prefix.release"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    prefix = result.stdout.strip()
    return prefix if result.returncode == 0 and prefix else "release/"


def git_flow_master_branch(repo_root: str) -> str:
    """Return the configured git-flow master branch name, defaulting to
    'main' if gitflow.branch.master is unset."""
    result = subprocess.run(
        ["git", "config", "gitflow.branch.master"],
        capture_output=True,
        text=True,
        cwd=repo_root,
    )
    branch = result.stdout.strip()
    return branch if result.returncode == 0 and branch else "main"


def repo_root_of_cwd() -> str:
    return subprocess.run(
        ["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True
    ).stdout.strip() or os.getcwd()


def main() -> int:
    data = json.load(sys.stdin)
    tool_name = data.get("tool_name")

    if tool_name in EDIT_TOOLS:
        path = data.get("tool_input", {}).get("file_path", "")
        if os.path.basename(path) == REVIEW_FILE and read_init_option_bool(
            repo_root_of_cwd(), "require_rdra_approval", False
        ):
            print(json.dumps(deny(
                f"{REVIEW_FILE} はレビュー画面からのみ更新できます。"
                "承認・差し戻しは人間がレビュー画面で行ってください。"
            )))
        return 0

    if tool_name != "Skill":
        return 0

    skill = data.get("tool_input", {}).get("skill", "")
    # Plugin skills may be passed either bare ("plan") or namespaced
    # ("geass:plan") -- match on the unqualified name either way rather than
    # assume one form, since a mismatch here would make the gate a silent
    # no-op.
    if ":" in skill:
        skill = skill.rsplit(":", 1)[-1]
    if skill not in GATED_SKILLS:
        return 0

    repo_root = repo_root_of_cwd()

    if skill == "feature-start":
        branch = root_worktree_branch(repo_root)
        prefix = git_flow_release_prefix(repo_root)
        if not branch or not branch.startswith(prefix):
            print(json.dumps(deny(
                f"ルートworktreeが {prefix}* ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/feature-start の前に、ルートworktreeで "
                "`git flow release start <version>` を実行してください。"
            )))
        return 0

    if skill == "fix-start":
        branch = root_worktree_branch(repo_root)
        master_branch = git_flow_master_branch(repo_root)
        prefix = git_flow_release_prefix(repo_root)
        if not branch or not (branch == master_branch or branch.startswith(prefix)):
            print(json.dumps(deny(
                f"ルートworktreeが {master_branch} または {prefix}* ブランチではありません"
                f"（現在: {branch or '(detached)'}）。"
                "/fix-start の前に、ルートworktreeで "
                f"`git checkout {master_branch}` または "
                "`git flow release start <version>` を実行してください。"
            )))
        return 0

    paths = resolve_feature_paths(repo_root)
    if paths is None:
        # Not currently inside a geass feature context -- nothing to gate.
        return 0

    feature_dir = paths.get("FEATURE_DIR", "")
    if not feature_dir:
        return 0

    if skill in RDRA_GATED_SKILLS and read_init_option_bool(repo_root, "require_rdra_approval", False):
        problem = rdra_approval_problem(repo_root, feature_dir)
        if problem:
            print(json.dumps(deny(problem)))
            return 0

    if skill not in EXECUTION_SKILLS:
        return 0
    if not read_init_option_bool(repo_root, "require_analyze_before_execute", True):
        return 0
    marker = os.path.join(repo_root, ".geass", "state", os.path.basename(feature_dir) + ".analyzed")
    if not os.path.isfile(marker):
        print(json.dumps(deny(
            f"analyze has not been run for this feature yet. "
            f"Run /analyze before {skill}."
        )))
    return 0


if __name__ == "__main__":
    sys.exit(main())
```

- [ ] **Step 4: Edit 系のツールにもゲートを掛ける**

`hooks/hooks.json` の `PreToolUse` 配列に 2 つ目の要素を追加する:

`hooks/hooks.json`:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse_gate.py\""
          }
        ]
      },
      {
        "matcher": "Edit|Write|MultiEdit",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/pretooluse_gate.py\""
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Skill",
        "hooks": [
          {
            "type": "command",
            "command": "python3 \"${CLAUDE_PLUGIN_ROOT}/hooks/posttooluse_analyze_marker.py\""
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 5: テストが通ることを確認する**

Run: `uv run --with pytest pytest tests -q`
Expected: 15 passed（`test_missing_node_blocks_instead_of_passing` は、最小の PATH から node が見える環境ではスキップされる）

- [ ] **Step 6: コミットする**

```bash
git add hooks/pretooluse_gate.py hooks/hooks.json tests/test_pretooluse_gate.py
git commit -m "Gate the spec pipeline on RDRA approval and protect review records"
```

---

### Task 3: /rdra スキル

**Files:**
- Create: `skills/rdra/SKILL.md`
- Test: `tests/test_rdra_skill.py`

**Interfaces:**
- Consumes: MCP ツール（計画 1 Task 11、計画 2 Task 2）、`cli.js wait-review`（計画 1 Task 12）、ゲート（Task 2）、`feature-start` の引き継ぎ文（Task 1）
- Produces: `/rdra`（`geass:rdra`）。feature-start からの引き継ぎでは、承認後に同じセッションで `/design-spec` を同じ引き継ぎ文で起動する

スキルが守ること（テストで一部を機械的に確認する）:
- 文書に出てくる `rdra_*` ツール名が、`mcp.ts` に登録されたツールとちょうど一致する
- 承認・差し戻しのツールは存在せず、スキルは AI が承認する手順を含まない
- 文書に出てくる `cli.js` のサブコマンドが `cli.ts` に実在する

- [ ] **Step 1: 失敗するテストを書く**

`tests/test_rdra_skill.py`:

```python
import re

from conftest import PLUGIN_ROOT

SKILL = (PLUGIN_ROOT / "skills" / "rdra" / "SKILL.md").read_text()
MCP = (PLUGIN_ROOT / "rdra-server" / "src" / "mcp.ts").read_text()
CLI = (PLUGIN_ROOT / "rdra-server" / "src" / "cli.ts").read_text()


def test_skill_documents_exactly_the_registered_tools() -> None:
    registered = set(re.findall(r'registerTool\(\s*"(rdra_[a-z_]+)"', MCP))
    documented = set(re.findall(r"\b(rdra_[a-z_]+)\b", SKILL))
    assert registered, "no tools found in mcp.ts"
    assert documented == registered


def test_skill_offers_no_way_to_approve() -> None:
    assert not re.search(r"registerTool\(\s*\"rdra_(approve|reject|decide)", MCP)


def test_skill_uses_existing_cli_commands() -> None:
    for command in re.findall(r"cli\.js\" ([a-z-]+)", SKILL):
        assert f'command === "{command}"' in CLI
```

- [ ] **Step 2: テストが失敗することを確認する**

Run: `uv run --with pytest pytest tests/test_rdra_skill.py -q`
Expected: FAIL（`skills/rdra/SKILL.md` がない）

- [ ] **Step 3: スキルを書く**

`skills/rdra/SKILL.md`:

````markdown
---
name: "rdra"
description: "Build or revise the project's RDRA model (docs/rdra) through dialogue using the rdra MCP tools, get it approved by a human in the local review UI, and hand off to /design-spec once approved."
argument-hint: "Feature description, or review feedback to address"
compatibility: "Requires the geass plugin's rdra MCP server (Node 22.13+)"
metadata:
  author: "geass"
  source: "geass/skills/rdra"
user-invocable: true
disable-model-invocation: false
---

# RDRA Modeling and Review

The project keeps one RDRA model for the whole system in `docs/rdra/*.yaml`. A feature changes that model; a human reviews the change in the local review UI and approves it (the GO signal) or sends it back with comments. Only after approval does the pipeline continue to `/design-spec`, and — when `require_rdra_approval` is true in `.geass/init-options.json` — the PreToolUse gate blocks `/design-spec`, `/specify`, `/plan`, `/tasks`, `/implement`, and plan execution until the model is approved and unchanged since.

## User Input

```text
$ARGUMENTS
```

If this invocation's prompt includes a line like `SPECIFY_FEATURE_DIRECTORY=<path> is already decided`, it was dispatched by `feature-start`: note `<path>` as `FEATURE_DIR` and the rest of `$ARGUMENTS` as `FEATURE_DESCRIPTION` — both are needed for the hand-off at the end. Otherwise this is a standalone invocation.

## Tools

All model access goes through the geass plugin's `rdra` MCP server (in Claude Code the tools appear as `mcp__plugin_geass_rdra__<name>`). Never edit `docs/rdra/*.yaml` or `rdra-review.json` with file tools — the server validates every change, keeps the review UI in sync, and is the only thing allowed to write review state.

| Tool | Use |
|---|---|
| `rdra_get_model` | Read the model (optionally one kind) |
| `rdra_query` | Read-only SQL over the model, e.g. which usecases touch an information |
| `rdra_validate` | Errors (block review) and warnings (shown to the reviewer) |
| `rdra_diff` | Element-level changes since the feature branch point |
| `rdra_upsert` / `rdra_delete` | Add or update elements (merge by id; `null` removes a field) / delete with cascade |
| `rdra_link` / `rdra_unlink` | Add or remove relations |
| `rdra_request_review` | Mark the model as waiting for review; returns the review UI URL |
| `rdra_review_status` | `none` / `pending` / `approved` / `rejected`, the last round's comments, and whether an approval is stale |

There is deliberately no tool to approve or reject. Approval is the human's decision, made in the review UI.

### Model reference

Kinds (`kind` for `rdra_upsert`) and id prefixes: `actors` `act.*`, `externalSystems` `ext.*`, `bucs` `buc.*` (optional `business`), `usecases` `uc.*`, `screens` `scr.*`, `events` `evt.*`, `information` `inf.*` (optional `attributes`), `states` `st.*` (`states: [{id, name}]`, `transitions: [{from, to}]`). Ids are `<prefix>.<kebab-slug>` and never change when a name changes.

Relations (`relation` for `rdra_link`), always written on the source element:

| relation | from → to | notes |
|---|---|---|
| `buc.actor`, `buc.usecase` | buc → act / uc | |
| `uc.actor`, `uc.screen`, `uc.event` | uc → act / scr / evt | |
| `uc.information` | uc → inf | `attrs.access`: `create` / `read` / `update` / `delete` |
| `uc.transition` | uc → `st.<model>:<from>-><to>` | the transition must exist in the state model |
| `evt.source`, `evt.target` | evt → act / ext | where the event comes from / goes to outside the system |
| `inf.related` | inf → inf | optional `attrs.label` |
| `st.information` | st → inf | which information the state model describes |

## Execution Flow

### Step 0: Pin the feature context

If `FEATURE_DIR` was handed off, persist it so the gate and the rdra server resolve the same feature:

```bash
mkdir -p .geass && printf '{"feature_directory":"%s"}\n' "<FEATURE_DIR>" > .geass/feature.json
```

Write the actual path (e.g. `specs/20260925-120000-order-cancel`), not the placeholder. Skip this step on standalone invocations.

### Step 1: Pick up where the review stands

Call `rdra_review_status`.

- `rejected`: the reviewer's comments in `lastRound.comments` are the work for this run. Each comment's `target` is an element id (or `null` for the whole model). Go to Step 3 and address every comment before anything else.
- `pending`: a review is already open. Tell the user the URL and go to Step 5 to wait.
- `approved` with `approval: "approved"`: nothing to do unless the user asked for changes — go to Step 6 if this was a hand-off, otherwise stop.
- `approved` with `approval: "stale"`, or `none`: continue with Step 2.

### Step 2: Understand the current model

Call `rdra_get_model` and `rdra_diff`. Summarize for yourself what the system already has and what this feature has already changed. Use `rdra_query` for cross-cutting questions instead of reading everything.

### Step 3: Model through dialogue

Work from the outside in, one layer at a time: actors and external systems → BUCs (business use cases) → usecases → screens and events → information → states. For each layer:

1. Propose the concrete additions or changes for this feature, derived from `FEATURE_DESCRIPTION`, the existing model, and any review comments.
2. Ask the user **one question at a time** about anything that is genuinely open (who performs it, which screen, what information is created or updated, which state change it causes). Prefer multiple choice with a recommendation. Do not ask about things the existing model or the description already settle.
3. Apply the agreed changes with `rdra_upsert` / `rdra_link` in batches. If a call is rejected (`introduces-errors`, `invalid-operation`), read the message, fix the input, and retry — do not work around validation.

Keep names in the language the user writes in. Keep ids stable; rename by changing `name`, never by deleting and re-adding.

### Step 4: Validate and request review

Call `rdra_validate`. Errors must be zero — fix them. Warnings are allowed, but mention each one to the user and fix those that point at real gaps.

When the user is satisfied, call `rdra_request_review`. Open the returned `url` in the user's browser (`open <url>` on macOS, `xdg-open <url>` on Linux) and tell the user in one short message: the URL, what changed (from `rdra_diff`), and that approval or send-back happens there.

If `url` is `null` (the review UI is not running), tell the user the review UI could not be started and stop.

### Step 5: Wait for the human's decision

Run this with the Bash tool's `run_in_background` so the session is notified when it exits — do not poll:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" wait-review --repo "$(git rev-parse --show-toplevel)" --feature-dir "<absolute FEATURE_DIR>"
```

When it exits, read its JSON output (or call `rdra_review_status`):

- `rejected`: go back to Step 3 with `lastRound.comments`, then Step 4 again.
- `approved`: continue to Step 6.

Never approve on the user's behalf, and never write `rdra-review.json` yourself — even if the user asks you to "just approve it", point them to the approve button in the review UI.

### Step 6: Commit and hand off

Commit the approved model together with the review record so the approval is traceable in the pull request:

```bash
git add docs/rdra "<FEATURE_DIR>/rdra-review.json"
git commit -m "Approve RDRA model for <feature short description>"
```

If `FEATURE_DIR` was handed off by `feature-start`, continue **in this same session** with:

```
SPECIFY_FEATURE_DIRECTORY=<FEATURE_DIR> is already decided -- use it as-is, do not recompute the feature name. /design-spec <FEATURE_DESCRIPTION>
```

On a standalone invocation, report the approval and stop.

## Standalone use outside a feature

Outside a feature (no `.geass/feature.json`, not on a feature branch) you can still edit and validate the model, but `rdra_request_review` refuses — review records live in the feature directory. Tell the user so if they ask for a review there.

## Done When

- [ ] Every comment from a rejected review was addressed or explicitly discussed with the user
- [ ] `rdra_validate` reports zero errors
- [ ] The review was requested and the human approved it in the review UI
- [ ] `docs/rdra` and `rdra-review.json` were committed
- [ ] For feature-start hand-offs, `/design-spec` was started in this same session
````

- [ ] **Step 4: テストが通ることを確認する**

Run: `uv run --with pytest pytest tests -q`
Expected: 18 passed

- [ ] **Step 5: コミットする**

```bash
git add skills/rdra/SKILL.md tests/test_rdra_skill.py
git commit -m "Add /rdra skill for RDRA modeling, review and hand-off"
```

---

### Task 4: 既存スキルの更新

**Files:**
- Modify: `skills/feature-start/SKILL.md`
- Modify: `skills/design-spec/SKILL.md`
- Modify: `skills/specify/SKILL.md`

**Interfaces:**
- Consumes: Task 1 の引き継ぎ先の切り替えと分岐点の記録、MCP の `rdra_diff` / `rdra_get_model`
- Produces: 承認済み RDRA を入力とする `/design-spec` と `/specify`。設計文書では Design ID の横に RDRA の ID（例: `(SCR-014, scr.order-confirm)`）、spec ではユーザーストーリーごとに `**RDRA:** <usecase ids>`

- [ ] **Step 1: feature-start を更新する**

`skills/feature-start/SKILL.md` を 4 か所変更する。

frontmatter の `description` の `open a new WezTerm tab, and hand off to /design-spec there (which itself hands off to /specify once design docs are written)."` を次に置き換える:

```
open a new WezTerm tab, and hand off to /rdra (when require_rdra_approval is set) or /design-spec there (which itself hands off to /specify once design docs are written)."
```

Step 2 の説明の `` `/design-spec` handoff prompt below; only the branch/worktree naming `` を次に置き換える:

```
   hand-off prompt below; only the branch/worktree naming
```

Step 4 の一覧の `` - Created a git worktree at `WORKTREE_PATH` `` の次に追加する:

```
   - Recorded `BASE_COMMIT` as `git config branch.<BRANCH_NAME>.geass-base-commit`,
     which the rdra server uses as the baseline for the feature's RDRA diff
```

同じ一覧の

```
     there with a prompt that runs `/design-spec` using
     `SPECIFY_FEATURE_DIRECTORY=SPEC_DIR` (already decided — the new session
     must not recompute the feature name)
```

を次に置き換える:

```
     there with a prompt that runs `/rdra` if `require_rdra_approval` is true
     in `.geass/init-options.json`, otherwise `/design-spec`, using
     `SPECIFY_FEATURE_DIRECTORY=SPEC_DIR` (already decided — the new session
     must not recompute the feature name)
```

- [ ] **Step 2: design-spec を更新する**

`skills/design-spec/SKILL.md` の `### Step 1: Confirm prerequisites` の最初の箇条（constitution の読み込み）の次に、次の 2 項目を追加する:

````markdown
- **IF `docs/rdra/` EXISTS**: load the RDRA model with the `rdra` MCP server's `rdra_diff` (what this feature changed) and `rdra_get_model` (the whole system). When `require_rdra_approval` is on, a human has already reviewed and approved this model — treat it as settled input, not as an open decision for the Design Decision Gate. Map it onto the documents below:

  | RDRA elements | Documents they drive |
  |---|---|
  | Information, state models (states and transitions) | `docs/schema/` — entities, attributes, state columns and allowed transitions |
  | Screens, and the usecases that use each screen | `docs/client/` — screens and UI flow; a screen's usecases are its actions |
  | Events, external systems | `docs/api/` — integrations and `data-flow.md` |
  | Usecases' information access (`create` / `read` / `update` / `delete`) and actors | `docs/api/` endpoints, `docs/security/` access-control matrix |

  Where a design unit implements an RDRA element, write the RDRA id next to its Design ID (e.g. `### 注文確認画面 (SCR-014, scr.order-confirm)`), so the chain RDRA → design doc → task → code stays traceable.
- If designing reveals that the RDRA model itself must change (a missing screen, an unmodeled piece of information), stop and tell the user to run `/rdra` — changing the model after approval invalidates the approval, and the gate will block the next step until it is reviewed again.
````

- [ ] **Step 3: specify を更新する**

`skills/specify/SKILL.md` の手順 1 の最後の箇条 `- If both sources are empty, skip silently — ...` の次に追加する:

```markdown
   - Separately, if `docs/rdra/` exists, call the `rdra` MCP server's `rdra_diff` and hold its changed BUCs and usecases as RDRA context. In step 9, build the user stories around those usecases, and under each user story add a line `**RDRA:** <usecase ids>` naming the usecases it covers (e.g. `**RDRA:** uc.place-order, uc.cancel-order`). The RDRA model was approved by a human — do not contradict it; if the dialogue reveals it is wrong, tell the user to run `/rdra` instead of silently diverging.
```

- [ ] **Step 4: 確認する**

Run: `grep -n "rdra" skills/feature-start/SKILL.md skills/design-spec/SKILL.md skills/specify/SKILL.md`
Expected: feature-start に 3 か所以上、design-spec に `rdra_diff` と `/rdra`、specify に `**RDRA:**` が出る

- [ ] **Step 5: コミットする**

```bash
git add skills/feature-start/SKILL.md skills/design-spec/SKILL.md skills/specify/SKILL.md
git commit -m "Feed the approved RDRA model into design-spec and specify"
```

---

### Task 5: README、バージョン、CI と通しの確認

**Files:**
- Modify: `README.md`
- Modify: `.claude-plugin/plugin.json`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: ここまでのすべて
- Produces: バージョン 0.11.0、`require_rdra_approval` の説明、CI（rdra-server の型検査・単体テスト・`dist` が最新かの確認・E2E、フックとハーネスの pytest）

- [ ] **Step 1: README を更新する**

`README.md` に次を反映する:

1. `## Requirements` の一覧の末尾に追加: `- Node.js 22.13 or later (for the RDRA MCP server and review UI)`
2. `## Usage` の最後の段落（`... are also usable standalone at any time.`）の後に、次の節を追加:

```markdown
## RDRA modeling and approval

geass keeps one RDRA model for the whole system in `docs/rdra/*.yaml`
(actors, external systems, BUCs, usecases, screens, events, information,
state models). The plugin ships an MCP server (`rdra`) that reads, edits,
validates, queries, and diffs that model, and serves a local review UI.

With `require_rdra_approval` enabled, a new feature starts with `/rdra`
instead of `/design-spec`:

1. `/rdra` builds the feature's change to the model through dialogue, using
   the MCP tools.
2. It requests a review and opens the review UI in your browser. There you
   see the model as five diagrams (system context, business flow, usecase
   composite, information model, state model), with this feature's changes
   highlighted, and can edit it directly.
3. You approve (the GO signal) or send it back with comments. A send-back
   returns the comments to the waiting `/rdra` session, which revises the
   model and asks for review again.
4. On approval, `/rdra` commits the model with its review record
   (`specs/<feature>/rdra-review.json`) and continues to `/design-spec`, which
   uses the approved model as input.

The gate blocks `/design-spec`, `/specify`, `/plan`, `/tasks`, `/implement`,
and plan execution until the feature's model is approved and unchanged since
approval, and refuses edits to `rdra-review.json` from file tools — approval
only happens in the review UI.
```

3. `## Configuration` の表の最後の行として追加:

```markdown
| `require_rdra_approval` | `false` | Start features with `/rdra` and require an approved RDRA model before the rest of the pipeline |
```

4. `## Project-local state` の一覧の末尾に追加:

```markdown
- `docs/rdra/` — the RDRA model (`layout/` holds diagram positions only)
- `specs/<feature>/rdra-review.json` — the feature's RDRA review record
```

5. ファイルの末尾に追加:

````markdown
## Development

The RDRA server lives in `rdra-server/` (TypeScript). Its build output in
`rdra-server/dist/` is committed so the plugin works without `npm install`.

```
cd rdra-server
npm ci
npm run typecheck
npx vitest run
npx playwright test        # needs `npx playwright install chromium` once
npm run build              # rebuild dist/ before committing
```

Hook and harness tests: `uv run --with pytest pytest tests` from the repo root.
````

- [ ] **Step 2: バージョンを上げる**

`.claude-plugin/plugin.json` を次にする:

`.claude-plugin/plugin.json`:

```json
{
  "name": "geass",
  "description": "Self-contained spec-driven development harness for Claude Code: RDRA requirements modeling with a local review UI and approval gate, a full fork of spec-kit's spec/plan/tasks/analyze pipeline, plus a git-flow release/hotfix worktree dispatcher (feature-start, fix-start), gated on the root worktree's git-flow branch state. No spec-kit installation required.",
  "version": "0.11.0",
  "author": {
    "name": "tetra0815"
  },
  "homepage": "https://github.com/tetra0815/geass",
  "repository": "https://github.com/tetra0815/geass",
  "license": "MIT",
  "keywords": [
    "git-flow",
    "worktree",
    "speckit",
    "release-management",
    "wezterm",
    "tmux",
    "rdra",
    "mcp"
  ]
}
```

- [ ] **Step 3: CI を追加する**

`.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

jobs:
  rdra-server:
    runs-on: ubuntu-latest
    defaults:
      run:
        working-directory: rdra-server
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.13"
          cache: npm
          cache-dependency-path: rdra-server/package-lock.json
      - run: npm ci
      - run: npm run typecheck
      - run: npx vitest run
      - name: Built dist/ is up to date
        run: |
          npm run build
          git diff --exit-code -- dist
      - run: npx playwright install --with-deps chromium
      - run: npx playwright test

  hooks:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "22.13"
      - uses: astral-sh/setup-uv@v6
      - run: uv run --with pytest pytest tests
```

`dist` のビルドは同じ入力なら同じ出力になり、手元の絶対パスも含まない（計画作成時に確認済み）ので、CI での差分チェックは安定する。

- [ ] **Step 4: すべてのテストを通す**

Run:

```bash
(cd rdra-server && npm run typecheck && npm run build && git diff --exit-code -- dist && npx vitest run && npx playwright test)
uv run --with pytest pytest tests -q
```

Expected: 型検査とビルドはエラーなし、`dist` に差分なし、vitest 116 件 PASS、Playwright 1 件 PASS、pytest 18 件 PASS

- [ ] **Step 5: Claude Code 上で通しで確認する**

リリースブランチ上の、`require_rdra_approval: true` を設定した検証用リポジトリで行う。

1. `claude --plugin-dir <このリポジトリ>` で起動し、`/feature-start 注文をキャンセルできるようにする` を実行する
2. 新しいタブのセッションが `/rdra` で始まり、`.geass/feature.json` を書いてから対話でモデルを作ることを確認する
3. レビュー画面が開き、差分の強調表示が出ることを確認する
4. `/specify` を手で実行すると、ゲートが「承認待ち」で拒否することを確認する
5. 画面でコメントを付けて差し戻し、待機中のセッションがコメントに対応して再度レビューを依頼することを確認する
6. 承認すると、セッションが `docs/rdra` と `rdra-review.json` をコミットし、`/design-spec` に進むことを確認する
7. `docs/rdra/*.yaml` を 1 か所書き換えて `/plan` を実行すると、「承認後に RDRA が変更されました」と変更された要素が表示されて拒否されることを確認する

- [ ] **Step 6: コミットする**

```bash
git add README.md .claude-plugin/plugin.json .github/workflows/ci.yml
git commit -m "Bump to 0.11.0: add RDRA modeling with a review UI and approval gate"
```

---

## 完了条件

- 上の Step 4 のコマンドがすべて通る。
- Step 5 の通しの確認で 1〜7 がすべて期待どおりに動く。
- `require_rdra_approval` を設定していないプロジェクトでは、`/feature-start` が従来どおり `/design-spec` から始まり、どのスキルもゲートで止まらない。
