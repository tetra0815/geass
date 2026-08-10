#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/harness-common.sh"

REPO_ROOT=$(get_repo_root) || exit 1
cd "$REPO_ROOT"

BUG_DESCRIPTION="$*"
if [ -z "$BUG_DESCRIPTION" ]; then
    echo "Usage: $0 <bug_description>" >&2
    exit 1
fi

NAME_SUFFIX=$(generate_slug_name "$BUG_DESCRIPTION")
BRANCH_NAME="hotfix/$NAME_SUFFIX"
WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/hotfix/$NAME_SUFFIX"

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    echo "Error: branch '$BRANCH_NAME' already exists" >&2
    exit 1
fi
if [ -e "$WORKTREE_PATH" ]; then
    echo "Error: worktree path '$WORKTREE_PATH' already exists" >&2
    exit 1
fi
check_terminal_multiplexer "$REPO_ROOT" || exit 1

mkdir -p "$REPO_ROOT/.claude/worktrees/hotfix"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" <<SETTINGSEOF
{
  "model": "claude-sonnet-5"
}
SETTINGSEOF

PROMPT="Use the superpowers:systematic-debugging skill to investigate and fix this bug: $BUG_DESCRIPTION"

spawn_claude_tab "$REPO_ROOT" "$WORKTREE_PATH" "$PROMPT"

echo "BRANCH_NAME: $BRANCH_NAME"
echo "WORKTREE_PATH: $WORKTREE_PATH"
