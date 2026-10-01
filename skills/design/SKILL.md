---
name: "design"
description: "Build or revise the project's design model (docs/design) — components, tables and design decisions — from the approved RDRA change through dialogue using the rdra MCP tools, get it approved by a human in the local review UI, and hand off to superpowers for planning and implementation."
argument-hint: "What to design, or review feedback to address"
compatibility: "Requires the geass plugin's rdra MCP server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# Design Modeling and Review

The RDRA model (`docs/rdra/`) decides what the system does. The design model (`docs/design/*.yaml`) decides how, for the parts every later feature builds on: the components the system runs as, the tables it stores data in, and the decisions behind them. It is one model for the whole system that grows feature by feature. Each element is an index entry — id, kind, relations to RDRA elements and to other design elements, a few attributes — and points with `doc` to the detailed document in its native form (ER diagram, DDL or ORM schema, architecture notes).

A feature changes the design on its `feature/<id>` branch after its RDRA change is approved. A human reviews the design change in the same local review UI and approves it (stage `design`) or sends it back. Until the design is approved — or the feature needs no design work — the geass gate blocks `superpowers:writing-plans`.

## User Input

```text
$ARGUMENTS
```

## Tools

The same `rdra` MCP server holds both models (in Claude Code the tools appear as `mcp__plugin_geass_rdra__<name>`). Never edit `docs/design/*.yaml`, `docs/rdra/*.yaml` or any review record with file tools.

| Tool | Use |
|---|---|
| `rdra_get_model` | Read the model; `kind: "components"`, `"tables"` or `"decisions"` for one design kind |
| `rdra_query` | Read-only SQL across both models, e.g. which tables realize an information element: `SELECT t.id FROM tables t JOIN relations r ON r.from_id = t.id WHERE r.kind = 'tbl.realizes' AND r.to_id = 'inf.order'` |
| `rdra_diff` | Element-level changes since the feature's base, RDRA and design together |
| `rdra_validate` | `issues` (errors block review) and `designFeatureIssues`: whether the design realizes this feature's RDRA change. Its errors block the design review |
| `rdra_upsert` / `rdra_delete` | Add or update design elements (merge by id; `null` removes a field) / delete with cascade |
| `rdra_link` / `rdra_unlink` | Add or remove relations |
| `rdra_request_review` | With `stage: "design"`, mark the design as waiting for review; returns the review UI URL |
| `rdra_review_status` | The RDRA review and, under `design`, the design review: `status`, `approval` (`stale` means it changed since approval), `lastRound` comments, and `required` (whether this feature needs a design approval at all) |

There is deliberately no tool to approve or reject.

### Model reference

| kind | id | required | optional |
|---|---|---|---|
| `components` | `comp.*` | `type`: `app` / `worker` / `datastore` / `queue` / `external` | `tech`, `dependsOn: [{ref: comp.*, label?}]`, `realizes: [ext.* / pr.*]`, `holds: [inf.*]`, `doc` |
| `tables` | `tbl.*` | `store` (a `datastore` component), `realizes: [inf.*]` (at least one) | `states: [st.*]`, `key`, `related: [{ref: tbl.*, label?}]`, `doc` |
| `decisions` | `adr.*` | `status`: `proposed` / `accepted` / `superseded`, `context`, `decision` | `alternatives: [string]`, `affects: [comp.* / tbl.*]`, `basis: [pr.*]`, `supersededBy: adr.*` |

- A component is a unit that runs or is deployed (C4 container): web front end, API server, worker, database, queue, an adapter to an external service. Not modules inside an app.
- A table is one table, collection or key space in one datastore. Columns are not modelled; they live in the document `doc` points at (and finally in migrations).
- `holds` names information a component keeps without a table: data only the external SaaS has, messages on a queue, session state.
- A table's `states` must be state models of information the table realizes — it is where those states are stored as a column.

Relations (`relation` for `rdra_link`), always written on the source element: `comp.depends` (comp → comp, `attrs.label`), `comp.realizes` (comp → ext / pr), `comp.holds` (comp → inf), `tbl.store` (tbl → comp), `tbl.realizes` (tbl → inf), `tbl.state` (tbl → st), `tbl.related` (tbl → tbl, `attrs.label`), `adr.affects` (adr → comp / tbl), `adr.basis` (adr → pr), `adr.superseded-by` (adr → adr).

Design elements point at RDRA elements; RDRA elements never point at the design.

### What `designFeatureIssues` asks for

For every RDRA element this feature added or changed:

- information `inf.*` is realized by a table or held by a component;
- an external system `ext.*` is realized by a component;
- a state model `st.*` whose information a table realizes is in that table's `states`;
- a `must` technology principle is realized by a component or is the `basis` of a decision (a warning only).

## Execution Flow

### Step 0: Check where you are

Run `git branch --show-current`. On a `feature/*` branch this run designs that feature and ends with a review. On any other branch you can still read, edit and validate the model, but `rdra_request_review` refuses — tell the user so if they ask for a review. Off a feature branch, skip Step 1 and Step 7's commit-and-hand-off and go to Step 3; never call `rdra_request_review`.

### Step 1: Check the stages

On a feature branch, call `rdra_review_status`.

- RDRA `approval` is not `approved`: the design starts from an approved RDRA change. Tell the user to finish `/rdra` first and stop.
- `design.status` is `rejected`: the reviewer's comments in `design.lastRound.comments` are the work for this run. Go to Step 4 and address every comment first.
- `design.status` is `pending`: a review is already open. Tell the user the URL and go to Step 6.
- `design.approval` is `approved`: nothing to do unless the user asked for changes — go to Step 7.
- `design.required` is `false` and `design.status` is `none`: this feature changes nothing the design has to follow. Tell the user they can go straight to `superpowers:writing-plans`, and stop unless they asked for design changes.
- `design.required` is `null`: the feature's diff base cannot be found, or the model YAML cannot be read. Report it and stop.
- Otherwise continue with Step 2.

### Step 2: Take over the existing system (once per project)

If `docs/design/` has no components and no tables yet, but the codebase already has a schema or a deployment (migrations, an ORM schema, `docker-compose.yaml`, infrastructure code):

1. Read them and draft the components and tables that already exist. For each, infer which RDRA information or external system it realizes.
2. Show the draft as one table and confirm or correct it with the user, one open question at a time.
3. Add what was agreed with `rdra_upsert`. It is part of this feature's design change and goes through the same review.
4. Everything taken over counts as added in this feature's design change, so `/trace` will require it. Tell the user, and in the plan name all taken-over components and tables on one task — e.g. "Record the existing design" — whose work is only to commit the design model. If the user prefers, do the takeover as its own design-only feature merged to develop first, so later features start from it.

### Step 3: Understand where the design stands

Call `rdra_diff` and `rdra_validate`. From `rdra_diff`, take the RDRA changes this feature's design has to follow; from `designFeatureIssues`, what is still unrealized. Read the existing components, tables and `accepted` decisions with `rdra_get_model` (or `rdra_query` for cross-cutting questions).

### Step 4: Design through dialogue

Work from the outside in, one layer at a time: components → tables → decisions → native documents. For each layer:

1. Propose the concrete additions or changes, derived from the RDRA change, the existing design and any review comments.
2. Ask the user **one question at a time** about anything genuinely open — which datastore holds this information, whether to extend an existing table or add one, which component talks to a new external system, what the key is. Prefer multiple choice with a recommendation. Do not ask about what the model already settles.
3. Apply the agreed changes with `rdra_upsert` / `rdra_link` in batches. If a call is rejected (`introduces-errors`, `invalid-operation`), read the message, fix the input and retry — do not work around validation.

Record a decision (`adr.*`) for every choice a later feature should not have to rediscover: choosing a datastore, splitting or merging tables, introducing a component, choosing how to integrate an external system. Give it `context`, `decision`, the `alternatives` you rejected and why, what it `affects`, and the principles it rests on (`basis`).

If the change goes against an `accepted` decision, show that decision to the user and ask. When they agree, add a new decision and set the old one to `status: superseded` with `supersededBy` pointing at the new one. Do not delete decisions.

Write the details the index does not hold — columns, indexes, constraints, sequence of calls — in a native document, using `${CLAUDE_PLUGIN_ROOT}/templates/README.md` to pick a template, and set the element's `doc` to its repository path. `rdra_validate` warns when a `doc` path does not exist.

If designing shows that the RDRA model is wrong or incomplete (information it lacks, an external system it does not have), stop and go back to `/rdra`. Changing the RDRA model invalidates both the RDRA and the design approval.

### Step 5: Validate and request review

Call `rdra_validate`. Errors in `issues` and errors in `designFeatureIssues` must be zero — fix them. Mention each warning to the user and fix those that point at real gaps.

When the user is satisfied, call `rdra_request_review` with `stage: "design"`. Open the returned `url` in the user's browser (`open <url>` on macOS, `xdg-open <url>` on Linux) and tell the user in one short message: the URL, what changed in the design (from `rdra_diff`), and that approval or send-back happens there.

If `url` is `null` (the review UI is not running), tell the user the review UI could not be started and stop.

### Step 6: Wait for the human's decision

Run this with the Bash tool's `run_in_background` so the session is notified when it exits — do not poll:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" wait-review --stage design --repo "$(git rev-parse --show-toplevel)"
```

When it exits, read its JSON output (or call `rdra_review_status`):

- `rejected`: go back to Step 4 with `design.lastRound.comments`, then Step 5 again.
- `approved`: continue to Step 7.

Exit codes other than 0: `2` means the review was no longer pending when the wait started — call `rdra_review_status` and continue from what it reports; `3` means the review record could not be read or this is not a feature branch — report it and stop; `124` happens only when an explicit `--timeout-sec` was given and elapsed.

Never approve on the user's behalf, and never write `docs/design/reviews/*.json` yourself.

### Step 7: Commit and hand off

Commit the approved design together with its review record and the native documents it points at:

```bash
git add docs/design
git commit -m "Approve design for <feature short description>"
```

(Add the `doc` files too if they live outside `docs/design/`.)

Then tell the user the next steps (do not start them yourself):

1. **Plan** — `superpowers:writing-plans`, with the approved RDRA and design models as settled input. The plan goes in `docs/superpowers/plans/` and is committed on this branch. Under each task heading, one line names what the task delivers, e.g. `Covers: uc.order-cancel#ac1, pr.audit-log, tbl.orders`. Besides every acceptance criterion and `must` principle `/rdra` lists, every component and table this feature added, changed or removed must appear in some task's `Covers:` line (a removed table needs the task that drops it). `superpowers:brainstorming` is optional, for details neither model holds.
2. **Check** — `/trace`, which verifies step 1 and unlocks execution.
3. **Build** — `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
4. **Finish** — `superpowers:finishing-a-development-branch`, opening the pull request against the branch's base with a summary of the RDRA and design diff and links to `docs/rdra/reviews/<feature>.json` and `docs/design/reviews/<feature>.json` in its body.

## Done When

- [ ] The RDRA change was approved before designing
- [ ] An existing system, if any, was taken over into components and tables
- [ ] Every comment from a rejected design review was addressed or explicitly discussed with the user
- [ ] Important choices are recorded as decisions; overturned ones are superseded, not deleted
- [ ] `rdra_validate` reports zero errors in `issues` and in `designFeatureIssues`
- [ ] The design review was requested and the human approved it in the review UI — or the feature needs no design approval
- [ ] `docs/design` (including the review record) was committed
- [ ] The next steps were given to the user
