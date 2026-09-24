---
name: "design-spec"
description: "Implementation spec and design document generation guide (general-purpose)"
argument-hint: "Optional guidance for specification phase"
compatibility: "Requires project constitution and geass structure"
metadata:
  author: "sommelier"
  source: "geass/skills/design-spec"
user-invocable: true
disable-model-invocation: false
---

# Design & Implementation Specification Skill

A guide for producing all the design documents needed for implementation, based on the project's **Constitution**.

## User Input

```text
$ARGUMENTS
```

If this invocation's prompt includes a line like `SPECIFY_FEATURE_DIRECTORY=<path> is already decided`, this was dispatched by `feature-start` as the start of a new feature: note the `<path>` and the rest of `$ARGUMENTS` as `FEATURE_DESCRIPTION` — they'll be needed for the hand-off to `/specify` at the end of this skill. Otherwise, this is a standalone invocation (e.g. updating design docs mid-project) — proceed without expecting a hand-off at the end.

---

## Output Document Structure

### 1. Data Schema Design (`docs/schema/`)

The type and number of storage systems varies per project (a single RDB, or RDB + cache + local DB + object storage, i.e. three or more). Don't force it into a fixed two-way split (primary/secondary) — scale the number of files to match the stores actually in use.

#### `overview.md`
- List of all storage/data stores used in the project (any type, any count)
- Each store's role and how it's chosen for a given use case (what goes where)
- Cross-store data consistency and synchronization strategy

#### `storage-<name>.md` (one file per store, as many as needed)
- Examples: `storage-primary-db.md`, `storage-cache.md`, `storage-local-db.md`, `storage-object-store.md`, `storage-search-index.md`, etc. — name to match the project's actual stores
- Schema for that store (tables/collections/key design, etc.)
- PK/SK, indexing strategy (where applicable)
- Attribute schema (types, constraints, defaults)
- Synchronization / master-data management policy with other stores (where applicable)
- Create/update/delete flow (soft vs. hard delete, cascade rules, etc.)
- Caching strategy (TTL, invalidation timing, where applicable)
- Versioning (optimistic-lock version numbers, change history, where applicable)

##### Copying the template

Depending on the store type, copy one of the following templates into `docs/schema/storage-<name>.md` and fill it in. Templates can be combined within the same `storage-<name>.md` (e.g. an RDB's ER diagram alongside a Redis key design, adjusted to fit the structure).

| Store type | Template | Purpose |
|---|---|---|
| RDB / document DB or other schema with relationships | `schema-er-diagram-template.md` | Entity-relationship design via a Mermaid ER diagram |
| DynamoDB | `schema-dynamodb-access-patterns-template.md` | Key design via an access-pattern table |
| Redis | `schema-redis-key-design-template.md` | Data-structure design via a key-design table |
| KVS/object storage or anything else | None (describe using only the `storage-<name>.md` items above) | - |

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/schema-er-diagram-template.md" docs/schema/storage-<name>.md
cp "${CLAUDE_PLUGIN_ROOT}/templates/schema-dynamodb-access-patterns-template.md" docs/schema/storage-<name>.md
cp "${CLAUDE_PLUGIN_ROOT}/templates/schema-redis-key-design-template.md" docs/schema/storage-<name>.md
```

#### `data-formats.md`
- Event/log format (JSON Schema)
- Message type definitions
- ID generation strategy
- Storage format (JSON/Parquet, etc.)

Copy the following template for the JSON Schema of events/messages.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/schema-data-formats-template.md" docs/schema/data-formats.md
```

---

### 2. API & Communication Design (`docs/api/`)

#### For RESTful APIs

Treat the OpenAPI definition as the source of truth. Copy the following to create `docs/api/openapi.yaml` and append endpoints to it as you go.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/api-openapi-template.yaml" docs/api/openapi.yaml
```

`endpoints.md` exists to keep a human-readable summary of `openapi.yaml` (the endpoint list and design intent); detailed Request/Response schemas live solely in `openapi.yaml` (to avoid maintaining the same thing twice).

#### For GraphQL (AppSync, etc.)

Instead of `endpoints.md` / `openapi.yaml`, copy the following to create `docs/api/graphql-schema.md`. Treat it as independent from the storage-side design (e.g. DynamoDB access patterns).

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/api-appsync-graphql-template.md" docs/api/graphql-schema.md
```

#### `data-flow.md`
- Data flow between components
- Sync/async patterns
- Error-handling flow

Copy the following template for a Mermaid data-flow diagram.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/api-data-flow-template.md" docs/api/data-flow.md
```

#### `error-handling.md`
- Error code definitions
- Exception patterns
- Retry strategy
- Fallback behavior

Copy the following template for the error-code definition table. Keep the `code` values in sync with the error schema in `openapi.yaml`/`graphql-schema.md`.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/api-error-handling-template.md" docs/api/error-handling.md
```

---

### 3. Security & Authentication (`docs/security/`)

#### `access-control.md`
- Multi-tenant / multi-user isolation policy
- Authorization model (RBAC/ABAC, etc.)
- Data access control

If you're building a Role × Resource × Action permission matrix, copy the following.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/security-access-control-matrix-template.md" docs/security/access-control.md
```

#### `authentication.md`
- Authentication method (OAuth/JWT/API Key, etc.)
- Token management
- Session strategy

#### `data-protection.md`
- Encryption at rest
- Encryption in transit
- Handling of sensitive information

---

### 4. Infrastructure Design (`docs/infrastructure/`)

#### `infrastructure-as-code.md`
- IaC template structure (CloudFormation/Terraform, etc.)
- Resource inventory
- Network and security configuration

#### `local-development.md`
- Local development environment setup
- Docker Compose / other virtualization
- Development workflow

#### `deployment.md`
- Environment configuration (dev/staging/prod)
- Deployment flow
- Rollback strategy

Copy the following template for the environment matrix table and the Mermaid deployment-flow diagram (including review/approval gates).

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/infrastructure-deployment-template.md" docs/infrastructure/deployment.md
```

---

### 5. Test Design (`docs/testing/`)

Test strategy (unit/integration/E2E policy, test scope) belongs to the Constitution's Core Principles, so it is not covered here. CI/CD integration is already part of the deployment-flow diagram in `docs/infrastructure/deployment.md`, so it is not covered here either.

#### `local-testing.md`
- Mock/stub strategy
- Test data management

Copy the following template for the mock/stub strategy table and test-data management.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/testing-local-testing-template.md" docs/testing/local-testing.md
```

---

### 6. Operations & Monitoring Design (`docs/operations/`)

#### `logging.md`
- Log schema
- Log level definitions
- Structured log format

Copy the following template for the structured-log field schema and level definitions.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/operations-logging-template.md" docs/operations/logging.md
```

#### `monitoring.md`
- Metric definitions
- Alert conditions
- Dashboard design

Copy the following template for the metrics/alerts definition table.

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/operations-monitoring-template.md" docs/operations/monitoring.md
```

---

### 7. Client Design (`docs/client/`)

#### `client-architecture.md`
- Client type (Web/Mobile/Desktop)
- Rationale for framework/tooling choices
- Offline-support strategy

#### `ui-ux.md`
- UI/UX design policy
- Page/screen inventory
- Screen transitions

Copy the following template for the screen inventory table and a Mermaid screen-transition diagram. Layout and internal implementation breakdown (wireframes), and the per-screen component usage/event behavior, are not covered here (write those in `screen-<name>.md` instead).

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/client-ui-flow-template.md" docs/client/ui-ux.md
```

#### `screen-<name>.md` (one file per screen, as many as needed)
- Component usage list (shared vs. screen-specific)
- Behavior on event triggers (which API is called, loading/error display, etc.)

```bash
cp "${CLAUDE_PLUGIN_ROOT}/templates/client-screen-template.md" docs/client/screen-<name>.md
```

API integration points are captured in `screen-<name>.md`'s event/behavior table, error handling lives in `docs/api/error-handling.md`, and auth flow lives in `docs/security/authentication.md` — so `integration.md` is not created.

---

## Design ID Convention

Every addressable unit a design document defines (a screen, an API endpoint, a table/collection/key-family, an event/message type, a security policy, an infrastructure resource, a log field or metric) gets a stable ID of the form `<PREFIX>-<NNN>` (3-digit zero-padded, e.g. `SCR-014`). This ID is the anchor that `/tasks` and `/implement` later use to trace a task and its code back to the design doc that specifies it — no separate mapping file is maintained; the ID itself, referenced from a task's `**Design Refs:**` field and from an inline code comment, is the link.

**Prefixes**:

| Prefix | Covers | Documents |
|---|---|---|
| `SCR` | Screens | `docs/client/screen-<name>.md`, `ui-ux.md` |
| `API` | API endpoints (REST/GraphQL) | `docs/api/endpoints.md`, `openapi.yaml`, `graphql-schema.md` |
| `RDB` | Relational/document DB schema | `docs/schema/storage-<name>.md` (RDB-type stores) |
| `MDB` | In-memory DB / cache | `docs/schema/storage-<name>.md` (Redis-type stores) |
| `OBJ` | Object/blob storage | `docs/schema/storage-<name>.md` (S3-type stores) |
| `EVT` | Event/message formats | `docs/schema/data-formats.md` |
| `SEC` | Auth, access control, data protection | `docs/security/*` |
| `INF` | Infrastructure/IaC/deployment | `docs/infrastructure/*` |
| `OPS` | Logging/monitoring | `docs/operations/*` |

**Assigning IDs**:
- Place the ID at whatever granularity the document already addresses that unit at — a heading (`### ログイン画面 (SCR-014)`), or an ID column in an inventory/summary table (`ui-ux.md`'s screen list, `endpoints.md`'s endpoint table, a `storage-<name>.md` table/key-design row). Don't invent a new table just to hold IDs.
- IDs are unique per prefix **across the whole project**, not reset per file or per feature. Before assigning a new ID, grep the relevant `docs/` subtree for existing `<PREFIX>-\d+` occurrences and continue from the current max + 1. This matters for standalone/mid-project invocations of this skill, which add to documents a prior feature already assigned IDs in.
- Never renumber or reuse a retired ID, even after the unit it named is removed — leave the gap. A stale code comment referencing a retired ID must not silently point at something else.

---

## Design Decision Gate

Before writing a document whose content hinges on a genuinely open design choice, surface it
and get the user's answer first — the same gate `superpowers:brainstorming` puts in front of
other creative work in this project, scaled down to one document's internal shape. This is
not a replacement for brainstorming: by the time `design-spec` runs, requirements are already
settled and the tech stack is already given (Step 1), so the only thing left open is *how one
document's design is shaped*.

**What counts as open**: a choice with real trade-offs that isn't already implied by the
constitution, the settled tech stack, the feature description, or a decision already approved
earlier in this same run — e.g. table normalization shape, sync vs. async data flow, RBAC vs.
ABAC, cache invalidation strategy, REST vs. an ad-hoc RPC shape for one endpoint group. Skip
the gate for anything mechanical or already dictated (a store type the tech stack already
named, an error-code format the constitution fixes, a field the data model obviously needs) —
re-litigating a settled decision wastes the user's time.

**The loop**, at most once per document:
1. List the open decisions found for that document. Batch independent ones into a single
   message; ask dependent ones one at a time, in dependency order.
2. For each, present 2-3 approaches with trade-offs and a recommendation (lead with the
   recommended one and say why) — the same shape as brainstorming's "Exploring approaches."
3. Get explicit approval (or the user's own answer) before writing any of that document.
4. Only then produce the document body, reflecting what was decided.

A document with nothing open skips the gate entirely — go straight to writing it.

---

## Execution Flow

### Step 1: Confirm prerequisites
- **IF EXISTS**: load `.geass/memory/constitution.md` to understand the project's principles and governance constraints (same loading method as the `specify` skill)
- **IF `docs/rdra/` EXISTS**: load the RDRA model with the `rdra` MCP server's `rdra_diff` (what this feature changed) and `rdra_get_model` (the whole system). When `require_rdra_approval` is on, a human has already reviewed and approved this model — treat it as settled input, not as an open decision for the Design Decision Gate. Map it onto the documents below:

  | RDRA elements | Documents they drive |
  |---|---|
  | Information, state models (states and transitions) | `docs/schema/` — entities, attributes, state columns and allowed transitions |
  | Screens, and the usecases that use each screen | `docs/client/` — screens and UI flow; a screen's usecases are its actions |
  | Events, external systems | `docs/api/` — integrations and `data-flow.md` |
  | Usecases' information access (`create` / `read` / `update` / `delete`) and actors | `docs/api/` endpoints, `docs/security/` access-control matrix |

  Where a design unit implements an RDRA element, write the RDRA id next to its Design ID (e.g. `### 注文確認画面 (SCR-014, scr.order-confirm)`), so the chain RDRA → design doc → task → code stays traceable.
- If designing reveals that the RDRA model itself must change (a missing screen, an unmodeled piece of information), stop and tell the user to run `/rdra` — changing the model after approval invalidates the approval, and the gate will block the next step until it is reviewed again.
- Confirm the tech stack and architecture patterns are settled — treat that choice as a given input to the design docs, not something to justify. Document what the settled choice is and how it's used; don't add rationale/comparison prose for why it was picked, in `infrastructure-as-code.md` or elsewhere, unless a section explicitly asks for it (e.g. `client-architecture.md`'s tooling-rationale bullet)

### Step 2-7: Produce documents
For each category, do the following:
1. Check consistency with `.geass/memory/constitution.md`
2. Identify open decisions for this document and run the Design Decision Gate above, if any
3. Flesh out the spec/design for that area
4. Write the document
5. Verify consistency with the Constitution

### Step 8: Hand off to `/specify` (feature-bootstrap invocations only)

If a `SPECIFY_FEATURE_DIRECTORY=<path> is already decided` instruction was present in this invocation's prompt (per User Input above), this run was dispatched by `feature-start` to kick off a new feature. Once the design docs above are written, hand off to `/specify` **in this same session** (do not open a new tab or worktree — that already happened):

```
SPECIFY_FEATURE_DIRECTORY=<path> is already decided -- use it as-is, do not recompute the feature name. /specify <FEATURE_DESCRIPTION>
```

`/specify` will pick up the diff of the design docs just written (see its Step 1) to ground the spec — and the feature short name it derives — in these decisions.

If no such instruction was present, this was a standalone design-doc update — stop here, there is nothing to hand off.

---

## Unified Output Format

Every document:

```markdown
# [Document Name]

## Overview
[What this document specifies, in one or two sentences]

## Spec / Design
[Table definitions, API spec, flow diagrams, etc.]

## Relation to Constitution
[Which Constitution principle(s) this is based on]

## Implementation Notes
[Open trade-offs and constraints that shape this document's design — not a task list, phased rollout, or roadmap; breaking work into phases/tasks is `/tasks`'s job, done later from these settled design docs]
```

These are design documents, not implementation — the `Spec / Design` section (tables, diagrams, schemas) is what pins down the design, so no `Sample / Example` section is needed on top of it. Only add one, as a short appendix of a few lines, when a single concrete instance is the clearest way to disambiguate a format already defined above (e.g. one sample log line for `logging.md`, one sample DynamoDB item for a key-design table) — never a runnable code block, function, class, or multi-step operational procedure/runbook (e.g. manual deploy steps, rollback playbooks — those belong to actual runbooks, not this design doc).

---

## Usage

```
/design-spec
```

---

## Checklist

Before considering this complete, confirm:

- [ ] Every open design decision was surfaced via the Design Decision Gate and approved before its document was written
- [ ] All documents are consistent with the Constitution
- [ ] The schema design is implementable
- [ ] The API spec follows the design patterns
- [ ] The security design meets requirements
- [ ] The test plan is executable
- [ ] Logging/monitoring is implementable given the Infrastructure design
- [ ] The client design is implementable with the chosen tech stack
- [ ] If this was a feature-bootstrap invocation (`SPECIFY_FEATURE_DIRECTORY` was already decided), handed off to `/specify` in this same session
