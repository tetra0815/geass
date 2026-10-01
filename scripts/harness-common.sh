#!/usr/bin/env bash
# Shared helpers for scripts/start-worktree.sh: locating the root worktree,
# reading .geass/init-options.json and git-flow settings, and opening a new
# claude session in a terminal tab.

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

# Print git config gitflow.<key>, or <default> when it is unset.
git_flow_config() {
    local value
    value=$(git config "gitflow.$1" 2>/dev/null) || value=''
    printf '%s' "${value:-$2}"
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
