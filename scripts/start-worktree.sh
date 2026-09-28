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
