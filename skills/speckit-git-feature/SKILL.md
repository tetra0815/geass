---
name: "speckit-git-feature"
description: "Create a dedicated branch and git worktree for a new feature, open it in a new WezTerm tab, and hand off spec creation to /speckit-specify there."
argument-hint: "Describe the feature you want to specify"
compatibility: "Requires spec-kit project structure with .specify/ directory, git flow, and WezTerm"
metadata:
  author: "sommelier"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

You **MUST** consider the user input before proceeding. If it is empty: ERROR
"No feature description provided" and stop.

## Precondition

This command only runs while the root worktree is checked out on a `release/*`
branch. That is enforced by `.claude/hooks/speckit_pretooluse_gate.py`, a
PreToolUse hook on this Skill — if this command's instructions are running at
all, the precondition already passed.

## Outline

1. Run, from the repository root:
   ```bash
   .specify/scripts/bash/create-feature-worktree.sh "$ARGUMENTS"
   ```
2. If the script exits non-zero: report its stderr output to the user verbatim
   and STOP. Do not retry automatically, do not create any files yourself.
3. On success, the script's stdout has three lines: `BRANCH_NAME`,
   `WORKTREE_PATH`, `SPEC_DIR`. By the time it returns, it has already:
   - Created branch `BRANCH_NAME` from the root worktree's current HEAD (the
     root worktree's own checkout is unchanged)
   - Created a git worktree at `WORKTREE_PATH`
   - Written `WORKTREE_PATH/.claude/settings.local.json` pinning that worktree
     to the Sonnet model
   - Opened a new WezTerm tab, cd'd into `WORKTREE_PATH`, and launched `claude`
     there with a prompt that runs `/speckit-specify` using
     `SPECIFY_FEATURE_DIRECTORY=SPEC_DIR` (already decided — the new session
     must not recompute the feature name)
4. Report completion to the user with `BRANCH_NAME`, `WORKTREE_PATH`, and
   `SPEC_DIR`.

**IMPORTANT**: Do **not** create `spec.md` or any other feature file yourself.
Actual spec creation happens in the new WezTerm tab's session, inside the
isolated worktree. This command's only job is to dispatch to that session.

## Done When

- [ ] `create-feature-worktree.sh` exited 0, or its failure was reported
  verbatim and the command stopped
- [ ] Completion reported to the user with `BRANCH_NAME`, `WORKTREE_PATH`,
  `SPEC_DIR`
- [ ] No spec files were created by this command
