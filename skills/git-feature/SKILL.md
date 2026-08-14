---
name: "git-feature"
description: "Create a dedicated branch and git worktree for a new feature, open a tracking GitHub issue, open a new WezTerm tab, and hand off to /design-spec there (which itself hands off to /specify once design docs are written)."
argument-hint: "Describe the feature you want to specify"
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
"No feature description provided" and stop.

## Precondition

This command only runs while the root worktree is checked out on a `release/*`
branch. That is enforced by the geass plugin's own `hooks/pretooluse_gate.py`,
a PreToolUse hook on this Skill — if this command's instructions are running
at all, the precondition already passed.

## Outline

1. Run, from the repository root:
   ```bash
   "${CLAUDE_PLUGIN_ROOT}/scripts/create-feature-worktree.sh" "$ARGUMENTS"
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
     there with a prompt that runs `/design-spec` using
     `SPECIFY_FEATURE_DIRECTORY=SPEC_DIR` (already decided — the new session
     must not recompute the feature name)

4. **Open a tracking issue** (GitHub remotes only):
   - Get the remote with `git config --get remote.origin.url`. If it is not a
     GitHub URL, skip this step silently — do not attempt to create an issue
     against a non-GitHub remote.
   - Use the GitHub MCP server's `create_issue` tool to open exactly one issue
     in the repository matching that remote:
     - Title: `Feature: <FEATURE_DESCRIPTION>` (the same description text
       passed to this command, not `BRANCH_NAME`)
     - Body: the feature description as given, plus the branch name
       (`BRANCH_NAME`) so the issue links back to the work
   - This is one issue per feature — do not create additional issues here for
     individual design docs or tasks (those come later, from `taskstoissues`).
   - If issue creation fails for any reason, report the failure to the user
     but do not treat it as fatal — the branch/worktree/session dispatch above
     already succeeded and should not be undone.

5. Report completion to the user with `BRANCH_NAME`, `WORKTREE_PATH`,
   `SPEC_DIR`, and the issue URL (or a note that issue creation was skipped
   or failed).

**IMPORTANT**: Do **not** create `spec.md` or any other feature file yourself.
Actual spec creation happens in the new WezTerm tab's session, inside the
isolated worktree. This command's only job is to dispatch to that session.

## Done When

- [ ] `create-feature-worktree.sh` exited 0, or its failure was reported
  verbatim and the command stopped
- [ ] Tracking issue created for GitHub remotes, or skipped/failed and
  reported as such
- [ ] Completion reported to the user with `BRANCH_NAME`, `WORKTREE_PATH`,
  `SPEC_DIR`, and issue status
- [ ] No spec files were created by this command
