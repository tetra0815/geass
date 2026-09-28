---
name: "rdra"
description: "Build or revise the project's RDRA model (docs/rdra) — principles, actors, usecases with acceptance criteria, screens, events, information, states — through dialogue using the rdra MCP tools, get it approved by a human in the local review UI, and hand off to superpowers for design, planning and implementation."
argument-hint: "Feature description, or review feedback to address"
compatibility: "Requires the geass plugin's rdra MCP server (Node 22.13+)"
metadata:
  author: "geass"
user-invocable: true
disable-model-invocation: false
---

# RDRA Modeling and Review

The project keeps one RDRA model for the whole system in `docs/rdra/*.yaml`. It is the single source of requirements: the project's principles (what used to be a constitution), who uses the system, its usecases and their acceptance criteria, screens, events, information and states. A feature changes that model on its `feature/<id>` branch; a human reviews the change in the local review UI and approves it (the GO signal) or sends it back with comments. Until the model is approved and unchanged, the geass gate blocks `superpowers:writing-plans`, and until `/trace` has passed it also blocks `superpowers:executing-plans` and `superpowers:subagent-driven-development`.

## User Input

```text
$ARGUMENTS
```

## Tools

All model access goes through the geass plugin's `rdra` MCP server (in Claude Code the tools appear as `mcp__plugin_geass_rdra__<name>`). Never edit `docs/rdra/*.yaml` or `docs/rdra/reviews/*.json` with file tools — the server validates every change, keeps the review UI in sync, and is the only thing allowed to write review state.

| Tool | Use |
|---|---|
| `rdra_get_model` | Read the model (optionally one kind) |
| `rdra_query` | Read-only SQL over the model, e.g. which must principles apply to a usecase (`principle_scope`), or all acceptance criteria (`acceptance`) |
| `rdra_validate` | `issues` (errors block review, warnings are shown to the reviewer) and `featureIssues` (checks on this feature's changes; they block review) |
| `rdra_diff` | Element-level changes since the feature's git-flow base; usecases also list `acceptance` changes per criterion |
| `rdra_upsert` / `rdra_delete` | Add or update elements (merge by id; `null` removes a field) / delete with cascade |
| `rdra_link` / `rdra_unlink` | Add or remove relations |
| `rdra_request_review` | Mark the model as waiting for review; returns the review UI URL |
| `rdra_review_status` | `none` / `pending` / `approved` / `rejected`, the last round's comments, and whether an approval is stale |

There is deliberately no tool to approve or reject. Approval is the human's decision, made in the review UI.

### Model reference

Kinds (`kind` for `rdra_upsert`) and id prefixes: `principles` `pr.*`, `actors` `act.*`, `externalSystems` `ext.*`, `bucs` `buc.*` (optional `business`), `usecases` `uc.*`, `screens` `scr.*`, `events` `evt.*`, `information` `inf.*` (optional `attributes`), `states` `st.*` (`states: [{id, name}]`, `transitions: [{from, to}]`). Ids are `<prefix>.<kebab-slug>` and never change when a name changes.

- A principle has `category` (`business` | `quality` | `security` | `engineering` | `technology`), `level` (`must` | `should`), optional `description` (what satisfying it means — expected for `must`), and `scope` (element ids it applies to; empty means the whole system).
- A usecase has `acceptance: [{id, given?, when, then}]`. Criterion ids are slugs unique within the usecase (`ac1`, `cancel-after-shipping`) and are referenced from elsewhere as `uc.<slug>#<id>`. Every usecase this feature adds or changes needs at least one criterion.

Relations (`relation` for `rdra_link`), always written on the source element:

| relation | from → to | notes |
|---|---|---|
| `pr.scope` | pr → act / ext / buc / uc / scr / inf / st | which elements a principle governs |
| `buc.actor`, `buc.usecase` | buc → act / uc | |
| `uc.actor`, `uc.screen`, `uc.event` | uc → act / scr / evt | |
| `uc.information` | uc → inf | `attrs.access`: `create` / `read` / `update` / `delete` |
| `uc.transition` | uc → `st.<model>:<from>-><to>` | the transition must exist in the state model |
| `evt.source`, `evt.target` | evt → act / ext | where the event comes from / goes to outside the system |
| `inf.related` | inf → inf | optional `attrs.label` |
| `st.information` | st → inf | which information the state model describes |

## Execution Flow

### Step 0: Check where you are

Run `git branch --show-current`. On a `feature/*` branch (e.g. one `/feature-start` created) this run models that feature and ends with a review. On any other branch you can still read, edit and validate the model, but `rdra_request_review` refuses — tell the user so if they ask for a review.

### Step 1: Take over an old constitution (once per project)

If `.geass/memory/constitution.md` exists and `docs/rdra/principles.yaml` does not:

1. Read the constitution and split every principle and every section rule into principle candidates: `id` (a slug of its name), `name`, `description` (the rule itself), `category` (inferred from the content: process rules such as TDD or review are `engineering`, stack choices are `technology`, performance and availability are `quality`), `level` (`MUST`, `NON-NEGOTIABLE`, `REQUIRED` → `must`; `SHOULD`, `RECOMMENDED` → `should`), and `scope: []`. Drop version lines, ratification dates and Sync Impact Reports — git history replaces them.
2. Show the candidates as one table and ask the user to confirm or correct them, one open question at a time.
3. Add the agreed principles with `rdra_upsert` (`kind: "principles"`), then `git rm .geass/memory/constitution.md`. The principles are part of this feature's change and go through the same review.

If `.geass/init-options.json` still has `require_rdra_approval`, `require_analyze_before_execute` or `feature_numbering`, tell the user once that these settings no longer do anything and can be removed (only `terminal_multiplexer` remains).

### Step 2: Pick up where the review stands

Call `rdra_review_status`.

- `rejected`: the reviewer's comments in `lastRound.comments` are the work for this run. Each comment's `target` is an element id (or `null` for the whole model). Go to Step 4 and address every comment before anything else.
- `pending`: a review is already open. Tell the user the URL and go to Step 6 to wait.
- `approved` with `approval: "approved"`: nothing to do unless the user asked for changes — go to Step 7.
- `approved` with `approval: "stale"`, or `none`: continue with Step 3.

### Step 3: Understand the current model

Call `rdra_get_model` and `rdra_diff`. Summarize for yourself what the system already has, which principles apply, and what this feature has already changed. Use `rdra_query` for cross-cutting questions instead of reading everything.

### Step 4: Model through dialogue

Work from the outside in, one layer at a time: principles that govern the whole system (only when the project has none yet, or the feature introduces a new one) → actors and external systems → BUCs → usecases → **acceptance criteria for every usecase this feature adds or changes** → screens and events → information → states → principles scoped to the elements this feature touches. For each layer:

1. Propose the concrete additions or changes for this feature, derived from the description, the existing model, and any review comments.
2. Ask the user **one question at a time** about anything genuinely open (who performs it, which screen, what information is created or updated, which state change it causes, what must be true afterwards, which edge cases must fail safely). Prefer multiple choice with a recommendation. Do not ask about what the model or the description already settles.
3. Apply the agreed changes with `rdra_upsert` / `rdra_link` in batches. If a call is rejected (`introduces-errors`, `invalid-operation`), read the message, fix the input, and retry — do not work around validation.

Write acceptance criteria so a test can be derived from each one: a concrete precondition (`given`), one action (`when`), and an observable outcome (`then`). Cover the main flow and each failure the user cares about.

Keep names in the language the user writes in. Keep ids stable; rename by changing `name`, never by deleting and re-adding.

### Step 5: Validate and request review

Call `rdra_validate`. Errors in `issues` and every entry in `featureIssues` must be zero — fix them. Warnings are allowed, but mention each one to the user and fix those that point at real gaps.

When the user is satisfied, call `rdra_request_review`. Open the returned `url` in the user's browser (`open <url>` on macOS, `xdg-open <url>` on Linux) and tell the user in one short message: the URL, what changed (from `rdra_diff`), and that approval or send-back happens there.

If `url` is `null` (the review UI is not running), tell the user the review UI could not be started and stop.

### Step 6: Wait for the human's decision

Run this with the Bash tool's `run_in_background` so the session is notified when it exits — do not poll:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" wait-review --repo "$(git rev-parse --show-toplevel)"
```

When it exits, read its JSON output (or call `rdra_review_status`):

- `rejected`: go back to Step 4 with `lastRound.comments`, then Step 5 again.
- `approved`: continue to Step 7.

Exit codes other than 0: `2` means the review was no longer pending when the wait started — call `rdra_review_status` and continue from the status it reports; `3` means the review record could not be read or this is not a feature branch — report it to the user and stop; `124` happens only when an explicit `--timeout-sec` was given and elapsed.

Never approve on the user's behalf, and never write `docs/rdra/reviews/*.json` yourself — even if the user asks you to "just approve it", point them to the approve button in the review UI.

### Step 7: Commit and hand off

Commit the approved model together with its review record so the approval is traceable in the pull request:

```bash
git add docs/rdra
git commit -m "Approve RDRA model for <feature short description>"
```

Then tell the user the next steps (do not start them yourself):

1. **Design** — `superpowers:brainstorming`, with the approved RDRA model as settled input: design only what the model leaves to technology (storage, APIs, security, infrastructure, operations, client). `${CLAUDE_PLUGIN_ROOT}/templates/README.md` lists the design documents and templates. Engineering and technology principles apply throughout.
2. **Plan** — `superpowers:writing-plans`. The plan goes in `docs/superpowers/plans/` and is committed on this branch. Under each task heading, one line names what the task delivers from the model, e.g. `Covers: uc.order-cancel#ac1, pr.audit-log`. Every acceptance criterion of a usecase this feature changed, and every `must` principle this feature added, changed or touches through its scope, must appear in some task's `Covers:` line.
3. **Check** — `/trace`, which verifies step 2 and unlocks execution.
4. **Build** — `superpowers:subagent-driven-development` or `superpowers:executing-plans`.
5. **Finish** — `superpowers:finishing-a-development-branch`, opening the pull request against the branch's base with a summary of the RDRA diff and a link to `docs/rdra/reviews/<feature>.json` in its body.

## Done When

- [ ] An old constitution, if any, was taken over as principles and removed
- [ ] Every comment from a rejected review was addressed or explicitly discussed with the user
- [ ] `rdra_validate` reports zero errors and zero `featureIssues`
- [ ] The review was requested and the human approved it in the review UI
- [ ] `docs/rdra` (including the review record) was committed
- [ ] The next steps were given to the user
