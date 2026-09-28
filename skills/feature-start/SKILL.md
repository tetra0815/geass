---
name: "feature-start"
description: "Start a feature the git-flow way: open a tracking GitHub issue, cut feature/<issue>-<slug> from develop into its own worktree, and open a new terminal tab that runs /rdra there."
argument-hint: "Describe the feature"
compatibility: "Requires git, git-flow branch settings (optional), gh for GitHub issues, and WezTerm or tmux"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

## User Input

```text
$ARGUMENTS
```

If it is empty: ERROR "No feature description provided" and stop.

## Outline

1. Make a short English slug for the feature (2-4 words, lowercase ASCII letters, digits and hyphens, e.g. `order-cancel`), whatever language the description is in. Call it `SLUG`.

2. Open a tracking issue when `origin` is a GitHub remote (`git remote get-url origin` contains `github.com`):

   ```bash
   gh issue create --title "Feature: <description>" --body-file - <<'EOF'
   <description, verbatim>
   EOF
   ```

   `gh` prints the issue URL; its last path segment is the issue number `NUMBER`. If the remote is not GitHub, or `gh` fails, continue without an issue and remember why for the report.

3. Name the branch `NAME="<NUMBER>-<SLUG>"` (just `<SLUG>` without an issue) and run, passing the prompt as one argument:

   ```bash
   PROMPT=$(cat <<'EOF'
   /rdra <description, verbatim>
   EOF
   )
   "${CLAUDE_PLUGIN_ROOT}/scripts/start-worktree.sh" feature "$NAME" "$PROMPT"
   ```

4. If the script exits non-zero, report its stderr verbatim and stop. Do not retry and do not create the branch yourself.

5. Report `BRANCH_NAME`, `WORKTREE_PATH`, `BASE_BRANCH`, `START_POINT` from the script's output and the issue URL (or why there is none).

Do not model, design or implement anything here — that happens in the new tab, starting with `/rdra`.

## Done When

- [ ] The script exited 0, or its error was reported verbatim
- [ ] An issue was created for GitHub remotes, or its absence was explained
- [ ] The branch, worktree, base and issue were reported
