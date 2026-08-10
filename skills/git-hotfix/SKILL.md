---
name: "git-hotfix"
description: "Create a dedicated hotfix branch and git worktree for a bug fix, open it in a new WezTerm tab, and hand off investigation/fixing to superpowers:systematic-debugging there."
argument-hint: "Describe the bug you need to fix"
compatibility: "Requires a .geass/ project directory, git flow, and WezTerm or tmux"
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
"No bug description provided" and stop.

## Precondition

This command only runs while the root worktree is checked out on the git-flow
master branch (`main` in this repo). That is enforced by the geass plugin's
own `hooks/pretooluse_gate.py`, a PreToolUse hook on this Skill — if this
command's instructions are running at all, the precondition already passed.

## Outline

1. Run, from the repository root:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/create-hotfix-worktree.sh" "$ARGUMENTS"
   ```
2. If the script exits non-zero: report its stderr output to the user verbatim
   and STOP. Do not retry automatically, do not create any files yourself.
3. On success, the script's stdout has two lines: `BRANCH_NAME`,
   `WORKTREE_PATH`. By the time it returns, it has already:
   - Created branch `BRANCH_NAME` (prefixed `hotfix/`) from the root worktree's
     current HEAD (the root worktree's own checkout is unchanged)
   - Created a git worktree at `WORKTREE_PATH`
   - Written `WORKTREE_PATH/.claude/settings.local.json` pinning that worktree
     to the Sonnet model
   - Opened a new WezTerm tab, cd'd into `WORKTREE_PATH`, and launched `claude`
     there with a prompt instructing it to use the
     `superpowers:systematic-debugging` skill to investigate and fix the bug
4. Report completion to the user with `BRANCH_NAME` and `WORKTREE_PATH`.

**IMPORTANT**: Do **not** investigate or fix the bug yourself, and do not create
any spec files — this project's bug fixes go through
`superpowers:systematic-debugging`, not the spec pipeline. Actual
investigation happens in the new WezTerm tab's session, inside the isolated
worktree. This command's only job is to dispatch to that session.

## Done When

- [ ] `create-hotfix-worktree.sh` exited 0, or its failure was reported
  verbatim and the command stopped
- [ ] Completion reported to the user with `BRANCH_NAME`, `WORKTREE_PATH`
- [ ] No investigation, fix, or file changes were made by this command
