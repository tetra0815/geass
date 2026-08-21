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
`create-hotfix-worktree.sh` itself also re-checks this immediately before
branching (belt-and-suspenders against the hook not firing for some reason)
and fails loudly if it doesn't hold.

## Outline

1. Generate a concise short name (2-4 words, English/ASCII only, action-noun
   format, e.g. "fix-payment-timeout") for the bug — regardless of what
   language `$ARGUMENTS` is written in. Branch and worktree names must stay
   ASCII; the script's own slugifier strips non-ASCII characters entirely
   and would otherwise produce a garbage branch name (or worse, a model
   that bypasses the script may be tempted to write the branch name in the
   description's own language instead — always translate to a short English
   slug here first). Call this `SHORT_NAME`.

2. Run, from the repository root:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/create-hotfix-worktree.sh" --slug "$SHORT_NAME" "$ARGUMENTS"
   ```
   Pass `$ARGUMENTS` unmodified (in its original language) after `--slug
   $SHORT_NAME` — it still drives the debugging hand-off prompt below; only
   the branch/worktree naming needs the English override.
3. If the script exits non-zero: report its stderr output to the user verbatim
   and STOP. Do not retry automatically, do not create any files yourself.
4. On success, the script's stdout has four lines: `BRANCH_NAME`,
   `WORKTREE_PATH`, `BASE_BRANCH`, `BASE_COMMIT`. By the time it returns, it
   has already:
   - Pulled the root worktree's current branch (`--ff-only`, no-op if it has
     no upstream) so the hotfix branch is based on the latest remote state
   - Created branch `BRANCH_NAME` (prefixed `hotfix/`) from the root worktree's
     (now up to date) current HEAD (the new worktree checks out a new
     branch; the root worktree's own branch is unaffected beyond the
     fast-forward pull above)
   - Created a git worktree at `WORKTREE_PATH`
   - Written `WORKTREE_PATH/.claude/settings.local.json` pinning that worktree
     to the Sonnet model
   - Opened a new WezTerm tab, cd'd into `WORKTREE_PATH`, and launched `claude`
     there with a prompt instructing it to use the
     `superpowers:systematic-debugging` skill to investigate and fix the bug
5. Report completion to the user with `BRANCH_NAME`, `WORKTREE_PATH`,
   `BASE_BRANCH`, and `BASE_COMMIT` — the latter two let the user immediately
   confirm the hotfix branch was actually cut from the master branch they
   expect, rather than having to dig this up later.

**IMPORTANT**: Do **not** investigate or fix the bug yourself, and do not create
any spec files — this project's bug fixes go through
`superpowers:systematic-debugging`, not the spec pipeline. Actual
investigation happens in the new WezTerm tab's session, inside the isolated
worktree. This command's only job is to dispatch to that session.

## Done When

- [ ] `create-hotfix-worktree.sh` exited 0, or its failure was reported
  verbatim and the command stopped
- [ ] Completion reported to the user with `BRANCH_NAME`, `WORKTREE_PATH`,
  `BASE_BRANCH`, `BASE_COMMIT`
- [ ] No investigation, fix, or file changes were made by this command
