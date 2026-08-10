#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

REPO_ROOT=$(get_repo_root) || exit 1
cd "$REPO_ROOT"

BUG_DESCRIPTION="$*"
if [ -z "$BUG_DESCRIPTION" ]; then
    echo "Usage: $0 <bug_description>" >&2
    exit 1
fi

# Reuse create-new-feature.sh's short-name/timestamp generation instead of
# duplicating it. Only the BRANCH_NAME field is used, as a raw name suffix --
# hotfixes have no spec directory, so SPEC_FILE/FEATURE_NUM are irrelevant here.
DRY_RUN_JSON=$("$SCRIPT_DIR/create-new-feature.sh" --dry-run --json --timestamp "$BUG_DESCRIPTION") || exit 1

if command -v jq >/dev/null 2>&1; then
    NAME_SUFFIX=$(printf '%s' "$DRY_RUN_JSON" | jq -r '.BRANCH_NAME')
else
    NAME_SUFFIX=$(printf '%s' "$DRY_RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["BRANCH_NAME"])')
fi

if [ -z "$NAME_SUFFIX" ] || [ "$NAME_SUFFIX" = "null" ]; then
    echo "Error: failed to compute a name from create-new-feature.sh --dry-run" >&2
    exit 1
fi

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
if ! command -v wezterm >/dev/null 2>&1; then
    echo "Error: wezterm CLI not found; aborting before creating any branch or worktree" >&2
    exit 1
fi

# Branch from the root worktree's current HEAD. This does not touch the root
# worktree's own checkout -- `git worktree add` only checks out the new branch
# in the new worktree directory.
mkdir -p "$REPO_ROOT/.claude/worktrees/hotfix"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" <<SETTINGSEOF
{
  "model": "claude-sonnet-5"
}
SETTINGSEOF

PROMPT="Use the superpowers:systematic-debugging skill to investigate and fix this bug: $BUG_DESCRIPTION"

wezterm cli spawn --cwd "$WORKTREE_PATH" -- claude "$PROMPT" >/dev/null

echo "BRANCH_NAME: $BRANCH_NAME"
echo "WORKTREE_PATH: $WORKTREE_PATH"
