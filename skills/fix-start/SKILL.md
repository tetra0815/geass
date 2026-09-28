---
name: "fix-start"
description: "Start a bug fix the git-flow way: cut hotfix/<slug> from the master branch into its own worktree and open a new terminal tab that investigates it with superpowers:systematic-debugging."
argument-hint: "Describe the bug"
compatibility: "Requires git, git-flow branch settings (optional), and WezTerm or tmux"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

If it is empty: ERROR "No bug description provided" and stop.

## Outline

1. Make a short English slug for the bug (2-4 words, lowercase ASCII letters, digits and hyphens, e.g. `fix-payment-timeout`). Call it `SLUG`.

2. Run, passing the prompt as one argument:

   ```bash
   PROMPT=$(cat <<'EOF'
   Use the superpowers:systematic-debugging skill to investigate and fix this bug: <description, verbatim>
   EOF
   )
   "${CLAUDE_PLUGIN_ROOT}/scripts/start-worktree.sh" hotfix "$SLUG" "$PROMPT"
   ```

3. If the script exits non-zero, report its stderr verbatim and stop.

4. Report `BRANCH_NAME`, `WORKTREE_PATH`, `BASE_BRANCH` and `START_POINT`.

Do not investigate or fix the bug here. Hotfixes do not go through `/rdra`; the RDRA gate does not apply to `hotfix/*` branches.

## Done When

- [ ] The script exited 0, or its error was reported verbatim
- [ ] The branch, worktree and base were reported
