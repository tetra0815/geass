---
name: "trace"
description: "Check that the feature's committed implementation plan covers every acceptance criterion and must principle its approved RDRA change requires (Covers: lines), and unlock plan execution when it does."
argument-hint: ""
compatibility: "Requires the geass plugin's rdra-server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# Trace the plan to the RDRA model

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
- **Exit 2** — it could not run (not a `feature/*` branch, a feature branch with a further `/` in its name, no base branch, no committed plan, unreadable RDRA YAML). Report the message and what to do about it.

If an uncovered item shows that the model itself is wrong (a criterion nobody wants), do not drop it from the check — the model has to change through `/rdra` and a new review.

Never write or edit `.geass/state/` yourself; only this command records a passing trace. Any later change to the plan (other than ticking checkboxes) or to the RDRA model requires running `/trace` again.
