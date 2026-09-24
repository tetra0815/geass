---
name: "rdra"
description: "Build or revise the project's RDRA model (docs/rdra) through dialogue using the rdra MCP tools, get it approved by a human in the local review UI, and hand off to /design-spec once approved."
argument-hint: "Feature description, or review feedback to address"
compatibility: "Requires the geass plugin's rdra MCP server (Node 22.13+)"
metadata:
  author: "geass"
  source: "geass/skills/rdra"
user-invocable: true
disable-model-invocation: false
---

# RDRA Modeling and Review

The project keeps one RDRA model for the whole system in `docs/rdra/*.yaml`. A feature changes that model; a human reviews the change in the local review UI and approves it (the GO signal) or sends it back with comments. Only after approval does the pipeline continue to `/design-spec`, and — when `require_rdra_approval` is true in `.geass/init-options.json` — the PreToolUse gate blocks `/design-spec`, `/specify`, `/plan`, `/tasks`, `/implement`, and plan execution until the model is approved and unchanged since.

## User Input

```text
$ARGUMENTS
```

If this invocation's prompt includes a line like `SPECIFY_FEATURE_DIRECTORY=<path> is already decided`, it was dispatched by `feature-start`: note `<path>` as `FEATURE_DIR` and the rest of `$ARGUMENTS` as `FEATURE_DESCRIPTION` — both are needed for the hand-off at the end. Otherwise this is a standalone invocation.

## Tools

All model access goes through the geass plugin's `rdra` MCP server (in Claude Code the tools appear as `mcp__plugin_geass_rdra__<name>`). Never edit `docs/rdra/*.yaml` or `rdra-review.json` with file tools — the server validates every change, keeps the review UI in sync, and is the only thing allowed to write review state.

| Tool | Use |
|---|---|
| `rdra_get_model` | Read the model (optionally one kind) |
| `rdra_query` | Read-only SQL over the model, e.g. which usecases touch an information |
| `rdra_validate` | Errors (block review) and warnings (shown to the reviewer) |
| `rdra_diff` | Element-level changes since the feature branch point |
| `rdra_upsert` / `rdra_delete` | Add or update elements (merge by id; `null` removes a field) / delete with cascade |
| `rdra_link` / `rdra_unlink` | Add or remove relations |
| `rdra_request_review` | Mark the model as waiting for review; returns the review UI URL |
| `rdra_review_status` | `none` / `pending` / `approved` / `rejected`, the last round's comments, and whether an approval is stale |

There is deliberately no tool to approve or reject. Approval is the human's decision, made in the review UI.

### Model reference

Kinds (`kind` for `rdra_upsert`) and id prefixes: `actors` `act.*`, `externalSystems` `ext.*`, `bucs` `buc.*` (optional `business`), `usecases` `uc.*`, `screens` `scr.*`, `events` `evt.*`, `information` `inf.*` (optional `attributes`), `states` `st.*` (`states: [{id, name}]`, `transitions: [{from, to}]`). Ids are `<prefix>.<kebab-slug>` and never change when a name changes.

Relations (`relation` for `rdra_link`), always written on the source element:

| relation | from → to | notes |
|---|---|---|
| `buc.actor`, `buc.usecase` | buc → act / uc | |
| `uc.actor`, `uc.screen`, `uc.event` | uc → act / scr / evt | |
| `uc.information` | uc → inf | `attrs.access`: `create` / `read` / `update` / `delete` |
| `uc.transition` | uc → `st.<model>:<from>-><to>` | the transition must exist in the state model |
| `evt.source`, `evt.target` | evt → act / ext | where the event comes from / goes to outside the system |
| `inf.related` | inf → inf | optional `attrs.label` |
| `st.information` | st → inf | which information the state model describes |

## Execution Flow

### Step 0: Pin the feature context

If `FEATURE_DIR` was handed off, persist it so the gate and the rdra server resolve the same feature:

```bash
mkdir -p .geass && printf '{"feature_directory":"%s"}\n' "<FEATURE_DIR>" > .geass/feature.json
```

Write the actual path (e.g. `specs/20260925-120000-order-cancel`), not the placeholder. Skip this step on standalone invocations.

### Step 1: Pick up where the review stands

Call `rdra_review_status`.

- `rejected`: the reviewer's comments in `lastRound.comments` are the work for this run. Each comment's `target` is an element id (or `null` for the whole model). Go to Step 3 and address every comment before anything else.
- `pending`: a review is already open. Tell the user the URL and go to Step 5 to wait.
- `approved` with `approval: "approved"`: nothing to do unless the user asked for changes — go to Step 6 if this was a hand-off, otherwise stop.
- `approved` with `approval: "stale"`, or `none`: continue with Step 2.

### Step 2: Understand the current model

Call `rdra_get_model` and `rdra_diff`. Summarize for yourself what the system already has and what this feature has already changed. Use `rdra_query` for cross-cutting questions instead of reading everything.

### Step 3: Model through dialogue

Work from the outside in, one layer at a time: actors and external systems → BUCs (business use cases) → usecases → screens and events → information → states. For each layer:

1. Propose the concrete additions or changes for this feature, derived from `FEATURE_DESCRIPTION`, the existing model, and any review comments.
2. Ask the user **one question at a time** about anything that is genuinely open (who performs it, which screen, what information is created or updated, which state change it causes). Prefer multiple choice with a recommendation. Do not ask about things the existing model or the description already settle.
3. Apply the agreed changes with `rdra_upsert` / `rdra_link` in batches. If a call is rejected (`introduces-errors`, `invalid-operation`), read the message, fix the input, and retry — do not work around validation.

Keep names in the language the user writes in. Keep ids stable; rename by changing `name`, never by deleting and re-adding.

### Step 4: Validate and request review

Call `rdra_validate`. Errors must be zero — fix them. Warnings are allowed, but mention each one to the user and fix those that point at real gaps.

When the user is satisfied, call `rdra_request_review`. Open the returned `url` in the user's browser (`open <url>` on macOS, `xdg-open <url>` on Linux) and tell the user in one short message: the URL, what changed (from `rdra_diff`), and that approval or send-back happens there.

If `url` is `null` (the review UI is not running), tell the user the review UI could not be started and stop.

### Step 5: Wait for the human's decision

Run this with the Bash tool's `run_in_background` so the session is notified when it exits — do not poll:

```bash
node "${CLAUDE_PLUGIN_ROOT}/rdra-server/dist/cli.js" wait-review --repo "$(git rev-parse --show-toplevel)" --feature-dir "<absolute FEATURE_DIR>"
```

When it exits, read its JSON output (or call `rdra_review_status`):

- `rejected`: go back to Step 3 with `lastRound.comments`, then Step 4 again.
- `approved`: continue to Step 6.

Exit codes other than 0: `2` means the review was no longer pending when the wait started — call `rdra_review_status` and continue from the status it reports; `3` means the review record could not be read — report it to the user and stop; `124` happens only when an explicit `--timeout-sec` was given and elapsed.

Never approve on the user's behalf, and never write `rdra-review.json` yourself — even if the user asks you to "just approve it", point them to the approve button in the review UI.

### Step 6: Commit and hand off

Commit the approved model together with the review record so the approval is traceable in the pull request:

```bash
git add docs/rdra "<FEATURE_DIR>/rdra-review.json"
git commit -m "Approve RDRA model for <feature short description>"
```

If `FEATURE_DIR` was handed off by `feature-start`, continue **in this same session** with:

```
SPECIFY_FEATURE_DIRECTORY=<FEATURE_DIR> is already decided -- use it as-is, do not recompute the feature name. /design-spec <FEATURE_DESCRIPTION>
```

On a standalone invocation, report the approval and stop.

## Standalone use outside a feature

Outside a feature (no `.geass/feature.json`, not on a feature branch) you can still edit and validate the model, but `rdra_request_review` refuses — review records live in the feature directory. Tell the user so if they ask for a review there.

## Done When

- [ ] Every comment from a rejected review was addressed or explicitly discussed with the user
- [ ] `rdra_validate` reports zero errors
- [ ] The review was requested and the human approved it in the review UI
- [ ] `docs/rdra` and `rdra-review.json` were committed
- [ ] For feature-start hand-offs, `/design-spec` was started in this same session
