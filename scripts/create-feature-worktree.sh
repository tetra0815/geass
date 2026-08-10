#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/common.sh"

REPO_ROOT=$(get_repo_root) || exit 1
cd "$REPO_ROOT"

FEATURE_DESCRIPTION="$*"
if [ -z "$FEATURE_DESCRIPTION" ]; then
    echo "Usage: $0 <feature_description>" >&2
    exit 1
fi

# Compute the branch/spec-dir name deterministically without creating anything yet,
# reusing create-new-feature.sh's naming logic instead of duplicating it.
# --timestamp is required here: create-new-feature.sh does not read
# init-options.json itself (only speckit-specify's own instructions do), so it
# must be told explicitly to match what the new worktree's /speckit-specify
# run will compute.
DRY_RUN_JSON=$("$SCRIPT_DIR/create-new-feature.sh" --dry-run --json --timestamp "$FEATURE_DESCRIPTION") || exit 1

if command -v jq >/dev/null 2>&1; then
    BRANCH_NAME=$(printf '%s' "$DRY_RUN_JSON" | jq -r '.BRANCH_NAME')
else
    BRANCH_NAME=$(printf '%s' "$DRY_RUN_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["BRANCH_NAME"])')
fi

if [ -z "$BRANCH_NAME" ] || [ "$BRANCH_NAME" = "null" ]; then
    echo "Error: failed to compute BRANCH_NAME from create-new-feature.sh --dry-run" >&2
    exit 1
fi

WORKTREE_PATH="$REPO_ROOT/.claude/worktrees/$BRANCH_NAME"
SPEC_DIR="specs/$BRANCH_NAME"

if git show-ref --verify --quiet "refs/heads/$BRANCH_NAME"; then
    echo "Error: branch '$BRANCH_NAME' already exists" >&2
    exit 1
fi
if [ -e "$WORKTREE_PATH" ]; then
    echo "Error: worktree path '$WORKTREE_PATH' already exists" >&2
    exit 1
fi
check_terminal_multiplexer "$REPO_ROOT" || exit 1

# Branch from the root worktree's current HEAD. This does not touch the root
# worktree's own checkout -- `git worktree add` only checks out the new branch
# in the new worktree directory.
mkdir -p "$REPO_ROOT/.claude/worktrees"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" <<SETTINGSEOF
{
  "model": "claude-sonnet-5"
}
SETTINGSEOF

PROMPT="SPECIFY_FEATURE_DIRECTORY=$SPEC_DIR is already decided -- use it as-is, do not recompute the feature name. /speckit-specify $FEATURE_DESCRIPTION"

spawn_claude_tab "$REPO_ROOT" "$WORKTREE_PATH" "$PROMPT"

echo "BRANCH_NAME: $BRANCH_NAME"
echo "WORKTREE_PATH: $WORKTREE_PATH"
echo "SPEC_DIR: $SPEC_DIR"
