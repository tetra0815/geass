#!/usr/bin/env bash
# Shared helpers for the geass worktree harness (create-feature-worktree.sh /
# create-hotfix-worktree.sh). Deliberately independent of spec-kit's own
# .specify/scripts/bash/common.sh: geass only relies on spec-kit's documented
# SPECIFY_FEATURE_DIRECTORY override (via speckit-specify's own SKILL.md),
# never on spec-kit's internal scripts, so spec-kit upgrades can't break it.

# Resolve the repository root by searching upward for a .specify/ marker.
get_repo_root() {
    local dir="${1:-$(pwd)}"
    dir="$(cd -- "$dir" 2>/dev/null && pwd)" || return 1
    local prev_dir=""
    while true; do
        if [ -d "$dir/.specify" ]; then
            echo "$dir"
            return 0
        fi
        if [ "$dir" = "/" ] || [ "$dir" = "$prev_dir" ]; then
            break
        fi
        prev_dir="$dir"
        dir="$(dirname "$dir")"
    done
    return 1
}

# Read a top-level string value from .specify/init-options.json.
# Prints the value, or empty string if the file/key is missing or
# unparseable. Always returns 0 so callers under `set -e` are not aborted.
read_init_option() {
    local repo_root="$1"
    local key="$2"
    local f="$repo_root/.specify/init-options.json"
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
            echo "Error: unknown terminal_multiplexer '$multiplexer' in .specify/init-options.json (expected 'wezterm' or 'tmux')" >&2
            return 1
            ;;
    esac
}

# Spawn `claude <prompt>` in a new tab/window at $worktree_path, using the
# terminal multiplexer configured via terminal_multiplexer in
# .specify/init-options.json (defaults to "wezterm"). Call
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
