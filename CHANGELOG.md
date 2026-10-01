# Changelog

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
