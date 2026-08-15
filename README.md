# geass

Self-contained spec-driven development harness for Claude Code.

A full fork of [spec-kit](https://github.com/github/spec-kit)'s spec-driven
pipeline (design-spec → specify → clarify → plan → tasks → analyze, plus
checklist, constitution, converge, implement, and taskstoissues) combined
with a git-flow release/hotfix worktree dispatcher. No spec-kit installation
is required — every script and template geass needs ships inside the plugin
itself.

Keeps your root worktree dedicated to release management. New feature work
and bugfixes each get their own git-flow branch, an isolated git worktree,
and a fresh `claude` session opened in a new WezTerm tab or tmux window —
dispatched automatically instead of by hand.

## Requirements

- git-flow (`gitflow.branch.master`, `gitflow.prefix.release` configured)
- WezTerm or tmux

## Install

```
/plugin marketplace add tetra0815/geass
/plugin install geass@geass
```

## Usage

- Root worktree on a `release/*` branch: `/feature-start <description>`
  creates a branch + worktree, opens a tracking GitHub issue (GitHub remotes
  only), opens a new tab, and runs `/design-spec` there.
- Root worktree on the git-flow master branch (default `main`):
  `/git-hotfix <description>` creates a `hotfix/*` branch + worktree, opens
  a new tab, and runs `superpowers:systematic-debugging` there.
- Inside a feature worktree, the pipeline is `/design-spec` (writes schema,
  API, security, infrastructure, testing, operations, and client design
  docs, then hands off to `/specify` in the same session) → `/clarify` →
  `/plan` → `/tasks` → `/analyze`, plus `/checklist`, `/constitution`,
  `/converge`, `/implement`, and `/taskstoissues`. `/design-spec` and
  `/specify` are also usable standalone at any time.

## Configuration

Add to `.geass/init-options.json` in your project:

| Key | Default | Meaning |
|---|---|---|
| `terminal_multiplexer` | `"wezterm"` | `"wezterm"` or `"tmux"` |
| `enforce_clarify_before_plan` | `true` | Require `/clarify` before `/plan` |
| `require_analyze_before_execute` | `true` | Require `/analyze` before `executing-plans`/`subagent-driven-development` |
| `feature_numbering` | `"sequential"` | `"sequential"` (`NNN-name`) or `"timestamp"` (`YYYYMMDD-HHMMSS-name`) |

Git-flow branch names are read from `git config gitflow.prefix.release` and
`git config gitflow.branch.master` (falling back to `release/` and `main`).

## Project-local state

A project using geass keeps only its own state under `.geass/`:

- `.geass/memory/constitution.md` — the project's constitution
- `.geass/init-options.json` — configuration (see above)
- `.geass/feature.json` — the currently active feature
- `.geass/state/` — `/analyze` completion markers

Everything else (scripts, templates, skill prompts) lives inside the plugin
and is shared across every project that installs it.
