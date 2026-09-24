# geass

Self-contained spec-driven development harness for Claude Code.

A full fork of [spec-kit](https://github.com/github/spec-kit)'s spec-driven
pipeline (design-spec → specify → plan → tasks → analyze, plus
checklist, constitution, converge, implement, and taskstoissues) combined
with a git-flow feature/fix worktree dispatcher. No spec-kit installation
is required — every script and template geass needs ships inside the plugin
itself.

Keeps your root worktree dedicated to release management. New feature work
and bugfixes each get their own git-flow branch, an isolated git worktree,
and a fresh `claude` session opened in a new WezTerm tab or tmux window —
dispatched automatically instead of by hand.

## Requirements

- git-flow (`gitflow.branch.master`, `gitflow.prefix.release` configured)
- WezTerm or tmux
- Node.js 22.13 or later (for the RDRA MCP server and review UI)

## Install

```
/plugin marketplace add tetra0815/geass
/plugin install geass@geass
```

## Usage

- Root worktree on a `release/*` branch: `/feature-start <description>`
  creates a branch + worktree, opens a tracking GitHub issue (GitHub remotes
  only), opens a new tab, and runs `/design-spec` there.
- Root worktree on the git-flow master branch (default `main`) or a
  `release/*` branch: `/fix-start <description>` creates a `hotfix/*` branch
  + worktree, opens a new tab, and runs `superpowers:systematic-debugging`
  there.
- Inside a feature worktree, the pipeline is `/design-spec` (writes schema,
  API, security, infrastructure, testing, operations, and client design
  docs, then hands off to `/specify` in the same session) → `/plan` →
  `/tasks` → `/analyze`, plus `/checklist`, `/constitution`,
  `/converge`, `/implement`, and `/taskstoissues`. `/specify` builds the
  spec through one-question-at-a-time dialogue and asks for explicit
  approval of the draft before writing it. `/design-spec` and `/specify`
  are also usable standalone at any time.

## RDRA modeling and approval

geass keeps one RDRA model for the whole system in `docs/rdra/*.yaml`
(actors, external systems, BUCs, usecases, screens, events, information,
state models). The plugin ships an MCP server (`rdra`) that reads, edits,
validates, queries, and diffs that model, and serves a local review UI.

With `require_rdra_approval` enabled, a new feature starts with `/rdra`
instead of `/design-spec`:

1. `/rdra` builds the feature's change to the model through dialogue, using
   the MCP tools.
2. It requests a review and opens the review UI in your browser. There you
   see the model as five diagrams (system context, business flow, usecase
   composite, information model, state model), with this feature's changes
   highlighted, and can edit it directly.
3. You approve (the GO signal) or send it back with comments. A send-back
   returns the comments to the waiting `/rdra` session, which revises the
   model and asks for review again.
4. On approval, `/rdra` commits the model with its review record
   (`specs/<feature>/rdra-review.json`) and continues to `/design-spec`, which
   uses the approved model as input.

The gate blocks `/design-spec`, `/specify`, `/plan`, `/tasks`, `/implement`,
and plan execution until the feature's model is approved and unchanged since
approval, and refuses edits to `rdra-review.json` from file tools — approval
only happens in the review UI.

## Configuration

Add to `.geass/init-options.json` in your project:

| Key | Default | Meaning |
|---|---|---|
| `terminal_multiplexer` | `"wezterm"` | `"wezterm"` or `"tmux"` |
| `require_analyze_before_execute` | `true` | Require `/analyze` before `executing-plans`/`subagent-driven-development` |
| `feature_numbering` | `"sequential"` | `"sequential"` (`NNN-name`) or `"timestamp"` (`YYYYMMDD-HHMMSS-name`) |
| `require_rdra_approval` | `false` | Start features with `/rdra` and require an approved RDRA model before the rest of the pipeline |

Git-flow branch names are read from `git config gitflow.prefix.release` and
`git config gitflow.branch.master` (falling back to `release/` and `main`).

## Project-local state

A project using geass keeps only its own state under `.geass/`:

- `.geass/memory/constitution.md` — the project's constitution
- `.geass/init-options.json` — configuration (see above)
- `.geass/feature.json` — the currently active feature
- `.geass/state/` — `/analyze` completion markers
- `docs/rdra/` — the RDRA model (`layout/` holds diagram positions only)
- `specs/<feature>/rdra-review.json` — the feature's RDRA review record

Everything else (scripts, templates, skill prompts) lives inside the plugin
and is shared across every project that installs it.

## Development

The RDRA server lives in `rdra-server/` (TypeScript). Its build output in
`rdra-server/dist/` is committed so the plugin works without `npm install`.

```
cd rdra-server
npm ci
npm run typecheck
npx vitest run
npx playwright test        # needs `npx playwright install chromium` once
npm run build              # rebuild dist/ before committing
```

Hook and harness tests: `uv run --with pytest pytest tests` from the repo root.
