#!/usr/bin/env bash
# Shared helpers for the geass worktree harness (create-feature-worktree.sh /
# create-hotfix-worktree.sh). Deliberately independent of spec-kit's own
# .specify/scripts/bash/common.sh: geass only relies on spec-kit's documented
# SPECIFY_FEATURE_DIRECTORY override (via speckit-specify's own SKILL.md),
# never on spec-kit's internal scripts, so spec-kit upgrades can't break it.

# Resolve the root (main) git worktree's absolute path, via `git worktree
# list`, which always lists the main worktree first regardless of which
# worktree (root or linked) this is invoked from.
#
# This harness must always branch off of and nest new worktrees under the
# true root worktree -- never a linked worktree (e.g. a previous feature's)
# that the caller's shell happens to be cd'd into. A directory-marker walk
# (searching upward for e.g. a .geass/ directory) cannot be used for this:
# every worktree of the repo checks out the same tracked files at its own
# top level, so a marker walk started inside a linked worktree finds that
# worktree's own copy of the marker immediately and stops there, silently
# resolving to the wrong worktree instead of continuing up to the root.
get_repo_root() {
    git worktree list --porcelain 2>/dev/null | awk '/^worktree /{print substr($0, 10); exit}'
    [[ "${PIPESTATUS[0]}" -eq 0 ]] || return 1
}

# Read a top-level string value from .geass/init-options.json.
# Prints the value, or empty string if the file/key is missing or
# unparseable. Always returns 0 so callers under `set -e` are not aborted.
read_init_option() {
    local repo_root="$1"
    local key="$2"
    local f="$repo_root/.geass/init-options.json"
    [[ -f "$f" ]] || { printf '%s' ''; return 0; }

    local val=''
    if command -v jq >/dev/null 2>&1; then
        val=$(jq -r --arg k "$key" '.[$k] // empty' "$f" 2>/dev/null) || val=''
    fi
    if [[ -z "$val" ]] && command -v python3 >/dev/null 2>&1; then
        val=$(python3 -c "
import json, sys
d = json.load(open(sys.argv[1]))
v = d.get(sys.argv[2])
print(v if v else '')
" "$f" "$key" 2>/dev/null) || val=''
    fi
    printf '%s' "$val"
    return 0
}

# Return the configured terminal multiplexer ("wezterm" or "tmux"),
# defaulting to "wezterm" when terminal_multiplexer is unset.
terminal_multiplexer() {
    local repo_root="$1"
    local val
    val=$(read_init_option "$repo_root" "terminal_multiplexer")
    printf '%s' "${val:-wezterm}"
}

# Validate that the configured terminal multiplexer is usable, without
# spawning anything. Call this before creating any branch/worktree so
# failures abort before any mutation.
check_terminal_multiplexer() {
    local repo_root="$1"
    local multiplexer
    multiplexer=$(terminal_multiplexer "$repo_root")

    case "$multiplexer" in
        wezterm)
            command -v wezterm >/dev/null 2>&1 || {
                echo "Error: wezterm CLI not found" >&2
                return 1
            }
            ;;
        tmux)
            command -v tmux >/dev/null 2>&1 || {
                echo "Error: tmux not found" >&2
                return 1
            }
            [[ -n "${TMUX:-}" ]] || {
                echo "Error: not inside a tmux session (\$TMUX is unset)" >&2
                return 1
            }
            ;;
        *)
            echo "Error: unknown terminal_multiplexer '$multiplexer' in .geass/init-options.json (expected 'wezterm' or 'tmux')" >&2
            return 1
            ;;
    esac
}

# Return the configured git-flow release branch prefix, defaulting to
# "release/" (mirrors hooks/pretooluse_gate.py's git_flow_release_prefix).
git_flow_release_prefix() {
    local prefix
    prefix=$(git config gitflow.prefix.release 2>/dev/null)
    printf '%s' "${prefix:-release/}"
}

# Return the configured git-flow master branch name, defaulting to "main"
# (mirrors hooks/pretooluse_gate.py's git_flow_master_branch).
git_flow_master_branch() {
    local branch
    branch=$(git config gitflow.branch.master 2>/dev/null)
    printf '%s' "${branch:-main}"
}

# Defense in depth alongside hooks/pretooluse_gate.py's own PreToolUse
# precondition check: verify the root worktree (must already be the cwd) is
# actually checked out on the expected branch right before this harness
# branches off of it, and print that branch name. $1 is either an exact
# branch name, or a prefix ending in "/" to match as a prefix.
#
# feature-start and git-hotfix have each been silently observed branching
# off the wrong base despite the PreToolUse gate supposedly covering this --
# whatever the exact cause (a swallowed/misrouted hook invocation, a race,
# etc.), this check makes that failure mode loud and diagnosable right here
# instead of silently producing a branch/worktree based on the wrong commit.
require_root_branch() {
    local expected="$1"
    local branch
    branch=$(git symbolic-ref --quiet --short HEAD) || {
        echo "Error: root worktree is in a detached HEAD state; expected '$expected'" >&2
        return 1
    }
    case "$expected" in
        */)
            case "$branch" in
                "$expected"*) ;;
                *)
                    echo "Error: root worktree is on '$branch', expected a '${expected}*' branch. Run \`git flow release start <version>\` (or \`git checkout\` to the right branch) in the root worktree first." >&2
                    return 1
                    ;;
            esac
            ;;
        *)
            if [[ "$branch" != "$expected" ]]; then
                echo "Error: root worktree is on '$branch', expected '$expected'. Run \`git checkout $expected\` in the root worktree first." >&2
                return 1
            fi
            ;;
    esac
    printf '%s' "$branch"
}

# Pull the root worktree's current branch (must already be the cwd) before
# branching off of it, so the new feature/hotfix branch is based on the
# latest remote state instead of whatever was last fetched locally. No-op
# if the current branch has no upstream configured (e.g. no remote, or an
# unpushed local-only branch). Uses --ff-only so a diverged local branch
# fails loudly here rather than silently branching off stale history.
pull_root_branch() {
    if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
        git pull --ff-only || {
            echo "Error: failed to pull the root worktree's branch (see git output above)" >&2
            return 1
        }
    fi
}

# Spawn `claude <prompt>` in a new tab/window at $worktree_path, using the
# terminal multiplexer configured via terminal_multiplexer in
# .geass/init-options.json (defaults to "wezterm"). Call
# check_terminal_multiplexer first so failures are caught before any git
# mutation.
spawn_claude_tab() {
    local repo_root="$1"
    local worktree_path="$2"
    local prompt="$3"
    local multiplexer
    multiplexer=$(terminal_multiplexer "$repo_root")

    # The spawning shell (this script, run from the caller's own Bash tool)
    # already has CLAUDE_CODE_CHILD_SESSION set, and that leaks into the new
    # pane's process. Claude Code then thinks the new session is a nested
    # child and silently turns off transcript saving there -- but the new
    # tab is a genuinely independent top-level session, so force persistence
    # back on for it explicitly.
    case "$multiplexer" in
        wezterm)
            wezterm cli spawn --cwd "$worktree_path" -- env CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 claude "$prompt" >/dev/null
            ;;
        tmux)
            tmux new-window -c "$worktree_path" -- env CLAUDE_CODE_FORCE_SESSION_PERSISTENCE=1 claude "$prompt" >/dev/null
            ;;
    esac
}

# Sanitize free text into a filesystem/branch-safe lowercase slug (letters,
# digits, single hyphens). Non-ASCII text (e.g. a Japanese feature
# description) has nothing left after this and collapses to an empty
# string -- callers should pass an already-English slug (see the callers'
# --slug flag) rather than relying on this to translate.
slugify() {
    local text="$1"
    printf '%s' "$text" \
        | tr '[:upper:]' '[:lower:]' \
        | sed 's/[^a-z0-9]/-/g' \
        | tr -s '-' \
        | sed 's/^-//' \
        | sed 's/-$//' \
        | cut -d'-' -f1-6
}

# Generate a filesystem/branch-safe "<timestamp>-<slug>" name from free text.
# Independent of spec-kit's create-new-feature.sh: the result is passed
# forward as SPECIFY_FEATURE_DIRECTORY, so it never needs to match spec-kit's
# own internal naming algorithm exactly.
generate_slug_name() {
    local description="$1"
    local timestamp
    timestamp=$(date +%Y%m%d-%H%M%S)

    local slug
    slug="$(slugify "$description")"
    slug="${slug:-feature}"

    printf '%s-%s' "$timestamp" "$slug"
}
