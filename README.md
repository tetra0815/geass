# geass

RDRA-centric development harness for Claude Code.

geass keeps one RDRA (Relationship Driven Requirement Analysis) model per project as the single source of requirements — including the project's principles and each usecase's acceptance criteria — has a human approve every change to it in a local review UI, and makes sure the implementation plan covers what was approved before any code is written. Everything around that is left to standard tools: git flow for branches, `gh` for issues and pull requests, and [superpowers](https://github.com/obra/superpowers) for design, planning and implementation.

## Requirements

- git (git-flow branch settings are honored when present)
- `gh` for GitHub issues and pull requests (optional)
- WezTerm or tmux
- Node.js 22.13 or later (for the RDRA MCP server and review UI)
- The superpowers plugin

## Install

```
/plugin marketplace add tetra0815/geass
/plugin install geass@geass
```

## Flow

```
/feature-start <description>   issue + feature/<#>-<slug> from develop in its own worktree, new tab runs /rdra
/rdra                          model principles, usecases and acceptance criteria → approve in the review UI → commit
superpowers:brainstorming      technical design from the approved model (templates/README.md)
superpowers:writing-plans      plan with "Covers: uc.<id>#<ac>, pr.<id>" under each task, committed on the branch
/trace                         plan covers every required criterion and principle → execution unlocked
superpowers:subagent-driven-development / executing-plans
superpowers:finishing-a-development-branch → pull request

/fix-start <description>       hotfix/<slug> from master in its own worktree, new tab runs superpowers:systematic-debugging
```

Skills do not call each other; each one ends by telling you the next step.

## The RDRA model

`docs/rdra/*.yaml` holds principles, actors, external systems, BUCs, usecases (with acceptance criteria), screens, events, information and state models. The plugin's MCP server (`rdra`) reads, edits, validates, queries and diffs it and serves the review UI, where you see the model as five diagrams plus a principles table, with the feature's changes highlighted, and can edit it directly.

- **Principles** (`pr.*`, `docs/rdra/principles.yaml`) replace a separate constitution: each has a category (`business`, `quality`, `security`, `engineering`, `technology`), a level (`must` / `should`) and an optional scope of elements it governs.
- **Acceptance criteria** live on usecases (`given` / `when` / `then`) and are referenced as `uc.<id>#<ac>`. Every usecase a feature adds or changes needs at least one before review can be requested.
- **Approval** is recorded in `docs/rdra/reviews/<feature>.json` and committed with the model. Only the review UI writes it.

## The gate

A PreToolUse hook blocks, on `feature/*` branches (a branch with the feature prefix but a further `/`, such as `feature/team/42-x`, is refused outright until renamed to `feature/<id>`):

- `superpowers:writing-plans` until the feature's RDRA change is approved and unchanged since;
- `superpowers:executing-plans` and `superpowers:subagent-driven-development` until, in addition, `/trace` has passed for the current model and plan (ticking checkboxes does not count as a change);
- edits to `docs/rdra/reviews/*.json` from file tools, on any branch.

If the gate cannot be evaluated (for example Node is missing), the gated call is denied.

## Branches

- Features are cut from `origin/<develop>` (or local `<develop>`) as `<feature prefix><issue>-<slug>`; hotfixes from `<master>` as `<hotfix prefix><slug>`. Names come from `git config gitflow.branch.develop`, `gitflow.branch.master`, `gitflow.prefix.feature` and `gitflow.prefix.hotfix` (defaults `develop`, `main`, `feature/`, `hotfix/`).
- Each branch gets a worktree at `.claude/worktrees/<branch>` under the root worktree and records its base as `gitflow.branch.<branch>.base`, which is also the base of the RDRA diff.
- Work is finished through a pull request (`git flow feature finish` is not used, because it checks out the base branch in the current worktree).

## Configuration

`.geass/init-options.json`:

| Key | Default | Meaning |
|---|---|---|
| `terminal_multiplexer` | `"wezterm"` | `"wezterm"` or `"tmux"` |

`.geass/state/` holds the local `/trace` result and ignores itself in git.

## Upgrading from 0.11

See [CHANGELOG.md](CHANGELOG.md).

## Development

The RDRA server lives in `rdra-server/` (TypeScript). Its build output in `rdra-server/dist/` is committed so the plugin works without `npm install`.

```
cd rdra-server
npm ci
npm run typecheck
npx vitest run
npx playwright test        # needs `npx playwright install chromium` once
npm run build              # rebuild dist/ before committing
```

Hook, script and skill tests: `uv run --with pytest pytest tests` from the repo root.
