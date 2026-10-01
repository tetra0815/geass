---
name: "trace"
description: "Check that the feature's committed implementation plan covers every acceptance criterion, must principle, component and table its approved RDRA and design changes require (Covers: lines), and unlock plan execution when it does."
argument-hint: ""
compatibility: "Requires the geass plugin's rdra-server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# Trace the plan to the RDRA and design models

Required items:

- every acceptance criterion (`uc.<id>#<ac>`) of a usecase the feature added or changed, and every `must` principle the feature added, changed or touches through its scope;
- every component (`comp.*`) and table (`tbl.*`) the feature's design added, changed or removed. A removed one is no longer in the model, but its id still counts — the task that tears it down (drops the table, removes the deployment) names it.

Design decisions (`adr.*`) are never required; naming them in `Covers:` is allowed.

Run from the feature's worktree, after `superpowers:writing-plans` has committed the plan:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" trace --repo "$(git rev-parse --show-toplevel)"
```

It prints a summary and, on its last line, JSON with `required`, `covered`, `uncovered`, `unknown`, `outOfScope` and `applicable`.

## Reading the result

- **Exit 0** — every required item is covered. Execution is unlocked. Tell the user in one short message, list the `applicable` principles (engineering and technology rules that apply to every task and are not traced per task), and suggest `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
- **Exit 1** — the plan falls short:
  - `uncovered`: required items no task names. For each, say which existing task should deliver it, or that a task is missing. With the user's agreement, add it to that task's `Covers:` line (and to the task's steps if the task does not actually deliver it yet), or add a task.
  - `unknown`: `Covers:` references that are not in the model — usually a typo or a renamed criterion. Fix them.
  - `outOfScope` is only a warning (a task also touches something outside this feature's change, e.g. a regression test); mention it.
  Commit the plan and run the command again. Repeat until it exits 0.
- **Exit 2** — it could not run (not a `feature/*` branch, a feature branch with a further `/` in its name, no base branch, no committed plan, unreadable RDRA or design YAML). Report the message and what to do about it.

If an uncovered item shows that a model itself is wrong (a criterion nobody wants, a table the feature should not touch), do not drop it from the check — the model has to change through `/rdra` or `/design` and a new review.

Never write or edit `.geass/state/` yourself; only this command records a passing trace. Any later change to the plan (other than ticking checkboxes), to the RDRA model or to the design model requires running `/trace` again.
