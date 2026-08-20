#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(CDPATH="" cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/harness-common.sh"

REPO_ROOT=$(get_repo_root) || exit 1
cd "$REPO_ROOT"

SLUG_OVERRIDE=""
if [ "$1" = "--slug" ]; then
    SLUG_OVERRIDE="$2"
    shift 2
fi

FEATURE_DESCRIPTION="$*"
if [ -z "$FEATURE_DESCRIPTION" ]; then
    echo "Usage: $0 [--slug ENGLISH_SLUG] <feature_description>" >&2
    exit 1
fi

if [ -n "$SLUG_OVERRIDE" ]; then
    # An explicit English slug (e.g. from a non-English feature description
    # the caller already translated) -- branch/worktree names must stay
    # ASCII regardless of the description's language.
    SLUG="$(slugify "$SLUG_OVERRIDE")"
    SLUG="${SLUG:-feature}"
    BRANCH_NAME="$(date +%Y%m%d-%H%M%S)-$SLUG"
else
    BRANCH_NAME=$(generate_slug_name "$FEATURE_DESCRIPTION")
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
pull_root_branch || exit 1

# Branch from the root worktree's current HEAD (now up to date, see above).
# `git worktree add` does not otherwise touch the root worktree's own
# checkout -- it only checks out the new branch in the new worktree
# directory.
mkdir -p "$REPO_ROOT/.claude/worktrees"
git worktree add -b "$BRANCH_NAME" "$WORKTREE_PATH" HEAD

mkdir -p "$WORKTREE_PATH/.claude"
cat > "$WORKTREE_PATH/.claude/settings.local.json" <<SETTINGSEOF
{
  "model": "claude-sonnet-5"
}
SETTINGSEOF

PROMPT="SPECIFY_FEATURE_DIRECTORY=$SPEC_DIR is already decided -- use it as-is, do not recompute the feature name. /design-spec $FEATURE_DESCRIPTION"

spawn_claude_tab "$REPO_ROOT" "$WORKTREE_PATH" "$PROMPT"

echo "BRANCH_NAME: $BRANCH_NAME"
echo "WORKTREE_PATH: $WORKTREE_PATH"
echo "SPEC_DIR: $SPEC_DIR"
