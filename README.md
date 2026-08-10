# geass

Git-flow release/hotfix worktree harness for Claude Code.

Keeps your root worktree dedicated to release management. New feature work
and bugfixes each get their own git-flow branch, an isolated git worktree,
and a fresh `claude` session opened in a new WezTerm tab or tmux window —
dispatched automatically instead of by hand.

## Requirements

- git-flow (`gitflow.branch.master`, `gitflow.prefix.release` configured)
- [spec-kit](https://github.com/github/spec-kit) (`.specify/` present) for
  `speckit-git-feature`
- WezTerm or tmux

## Install

```
/plugin marketplace add tetra0815/geass
/plugin install geass@geass
```

## Usage

- Root worktree on a `release/*` branch: `/speckit-git-feature <description>`
  creates a branch + worktree, opens a new tab, and runs `/speckit-specify`
  there.
- Root worktree on the git-flow master branch (default `main`):
  `/speckit-git-hotfix <description>` creates a `hotfix/*` branch + worktree,
  opens a new tab, and runs `superpowers:systematic-debugging` there.

## Configuration

Add to `.specify/init-options.json`:

| Key | Default | Meaning |
|---|---|---|
| `terminal_multiplexer` | `"wezterm"` | `"wezterm"` or `"tmux"` |
| `enforce_clarify_before_plan` | `true` | Require `speckit-clarify` before `speckit-plan` |
| `require_analyze_before_execute` | `true` | Require `speckit-analyze` before `executing-plans`/`subagent-driven-development` |

Git-flow branch names are read from `git config gitflow.prefix.release` and
`git config gitflow.branch.master` (falling back to `release/` and `main`).
