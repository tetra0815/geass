# Changelog

## 0.13.0

geass gains a design model next to the RDRA model: the components the system runs as, the tables it stores data in, and the decisions behind them, approved by a human like the RDRA change.

### Added

- The design model in `docs/design/` — `components` (`comp.*`), `tables` (`tbl.*`) and `decisions` (`adr.*`) — read and edited through the same MCP tools, checked by `rdra_validate`, and queryable as the `components`, `tables` and `decisions` views of `rdra_query`.
- `/design`: models the design for the approved RDRA change, takes over an existing system's schema and deployment on first use, and gets the design approved in the review UI.
- `designFeatureIssues` from `rdra_validate`: every information element, external system and state model a feature adds or changes must be realized by the design.
- The design review: `rdra_request_review` and `rdra_review_status` take or report `stage: "design"`, `cli.js wait-review --stage design`, `cli.js hash --stage design`, and approval records in `docs/design/reviews/<feature>.json`.
- The review UI shows a component diagram, a data diagram and a list of design decisions, and approves or sends back whichever review is open.

### Changed

- The gate blocks `superpowers:writing-plans` until the feature's design is approved as well, unless the feature needs no design work.
- `/trace` also requires every component and table the feature added, changed or removed in some task's `Covers:` line.
- `/rdra` hands off to `/design`; `superpowers:brainstorming` is no longer a required step.
- RDRA approvals are judged on the RDRA model alone, so editing the design never invalidates them. The hash value is unchanged from 0.12.0.

### Upgrading

1. Approved RDRA changes stay approved.
2. Run `/trace` again on features that had passed it: the trace record format changed and old records are ignored.
3. A feature in progress needs `/design` before planning only if it changes a design element or its RDRA change is not yet realized by the design (an information element without a table or holding component, an external system without a component, a stored state model missing from its table). Features that do not, plan as before.
4. The first `/design` run in a project offers to take over the existing schema and deployment into the design model. Everything taken over counts as added in that feature, so its plan names it on one task (or do the takeover as its own feature first).

## 0.12.0

geass no longer carries the spec-kit pipeline. The RDRA model is the single source of requirements, and design, planning and implementation run on superpowers.

### Removed

- Skills `/specify`, `/plan`, `/tasks`, `/analyze`, `/checklist`, `/converge`, `/constitution`, `/implement`, `/taskstoissues` and `/design-spec`, the `scripts/bash/` helpers, and the spec, plan, tasks, checklist and constitution templates.
- `.geass/feature.json`, `specs/NNN-*` numbering, and the settings `require_rdra_approval`, `require_analyze_before_execute` and `feature_numbering`. RDRA approval and `/trace` are always required.
- The requirement that the root worktree be on a `release/*` branch before `/feature-start`.

### Added

- Principles (`pr.*`, `docs/rdra/principles.yaml`) and usecase acceptance criteria in the RDRA model, in the review UI, in `rdra_query` and in `rdra_diff`.
- `/trace` (`cli.js trace`): checks the plan's `Covers:` lines against the feature's RDRA change and unlocks execution.
- `scripts/start-worktree.sh`, used by `/feature-start` and `/fix-start`.

### Changed

- Features are `feature/<issue>-<slug>` branches cut from `develop`; the RDRA diff is taken against `gitflow.branch.<branch>.base`.
- Review records moved from `specs/<feature>/rdra-review.json` to `docs/rdra/reviews/<feature>.json`.
- `cli.js check-approval` and `wait-review` take only `--repo`; the feature comes from the current branch.
- The gate now covers `superpowers:writing-plans`, `executing-plans` and `subagent-driven-development`.

### Upgrading

1. Finish (merge) features that are in progress on 0.11 before upgrading; their `specs/<feature>/rdra-review.json` records are not migrated.
2. Start the next feature with `/feature-start`. The first `/rdra` run turns `.geass/memory/constitution.md` into principles with you, removes the file, and puts the principles through review with that feature.
3. Remove `require_rdra_approval`, `require_analyze_before_execute` and `feature_numbering` from `.geass/init-options.json`.
4. Existing `specs/*/spec.md`, `plan.md` and `tasks.md` stay as history; nothing reads them anymore.
