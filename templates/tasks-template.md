---

description: "Task list template for feature implementation"
---

# Tasks: [FEATURE NAME]

**Input**: Design documents from `/specs/[###-feature-name]/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md, data-model.md, contracts/

**Tests**: The examples below include test tasks. Tests are OPTIONAL - only include them if explicitly requested in the feature specification.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story. Tasks are numbered sequentially across the whole document (Task 1, Task 2, ...) so each one can be found and dispatched independently by superpowers:subagent-driven-development / superpowers:executing-plans.

## Format

Each task is its own subsection:

```
### Task N: <short description>

**Story:** US1 | **Parallel:** yes

**Files:**
- Create: `path/to/file.py`

**Interfaces:**
- Produces: <what later tasks rely on, if anything>

- [ ] <what to do>
```

- **Story**: which user story this task belongs to (US1, US2, US3, ...). Omit the `**Story:**` line entirely for Setup/Foundational/Polish tasks — they don't belong to a story.
- **Parallel**: `yes` if this task can run in parallel with sibling tasks in the same phase (different files, no dependency on an incomplete task in this phase); omit the field entirely when the task is not parallel-safe.
- **Files**: exact paths this task creates or modifies.
- **Interfaces**: only include when a later task needs to know a name/signature this task introduces (e.g. a model class a service task will import). Omit entirely for tasks nothing else depends on.

## Path Conventions

- **Single project**: `src/`, `tests/` at repository root
- **Web app**: `backend/src/`, `frontend/src/`
- **Mobile**: `api/src/`, `ios/src/` or `android/src/`
- Paths shown below assume single project - adjust based on plan.md structure

<!--
  ============================================================================
  IMPORTANT: The tasks below are SAMPLE TASKS for illustration purposes only.

  The /tasks command MUST replace these with actual tasks based on:
  - User stories from spec.md (with their priorities P1, P2, P3...)
  - Feature requirements from plan.md
  - Entities from data-model.md
  - Endpoints from contracts/

  Tasks MUST be organized by user story so each story can be:
  - Implemented independently
  - Tested independently
  - Delivered as an MVP increment

  DO NOT keep these sample tasks in the generated tasks.md file.
  ============================================================================
-->

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Project initialization and basic structure

### Task 1: Create project structure per implementation plan

- [ ] Create project structure per implementation plan

### Task 2: Initialize [language] project with [framework] dependencies

- [ ] Initialize [language] project with [framework] dependencies

### Task 3: Configure linting and formatting tools

**Parallel:** yes

- [ ] Configure linting and formatting tools

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core infrastructure that MUST be complete before ANY user story can be implemented

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

Examples of foundational tasks (adjust based on your project):

### Task 4: Setup database schema and migrations framework

- [ ] Setup database schema and migrations framework

### Task 5: Implement authentication/authorization framework

**Parallel:** yes

- [ ] Implement authentication/authorization framework

### Task 6: Setup API routing and middleware structure

**Parallel:** yes

- [ ] Setup API routing and middleware structure

### Task 7: Create base models/entities that all stories depend on

- [ ] Create base models/entities that all stories depend on

### Task 8: Configure error handling and logging infrastructure

- [ ] Configure error handling and logging infrastructure

### Task 9: Setup environment configuration management

- [ ] Setup environment configuration management

**Checkpoint**: Foundation ready - user story implementation can now begin in parallel

---

## Phase 3: User Story 1 - [Title] (Priority: P1) 🎯 MVP

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 1 (OPTIONAL - only if tests requested) ⚠️

> **NOTE: Write these tests FIRST, ensure they FAIL before implementation**

### Task 10: Contract test for [endpoint]

**Story:** US1 | **Parallel:** yes

**Files:**
- Create: `tests/contract/test_[name].py`

- [ ] Contract test for [endpoint]

### Task 11: Integration test for [user journey]

**Story:** US1 | **Parallel:** yes

**Files:**
- Create: `tests/integration/test_[name].py`

- [ ] Integration test for [user journey]

### Implementation for User Story 1

### Task 12: Create [Entity1] model

**Story:** US1 | **Parallel:** yes

**Files:**
- Create: `src/models/[entity1].py`

- [ ] Create [Entity1] model

### Task 13: Create [Entity2] model

**Story:** US1 | **Parallel:** yes

**Files:**
- Create: `src/models/[entity2].py`

- [ ] Create [Entity2] model

### Task 14: Implement [Service]

**Story:** US1

**Files:**
- Create: `src/services/[service].py`

**Interfaces:**
- Consumes: `[Entity1]` (Task 12), `[Entity2]` (Task 13)

- [ ] Implement [Service] (depends on Task 12, Task 13)

### Task 15: Implement [endpoint/feature]

**Story:** US1

**Files:**
- Create: `src/[location]/[file].py`

- [ ] Implement [endpoint/feature]

### Task 16: Add validation and error handling

**Story:** US1

- [ ] Add validation and error handling

### Task 17: Add logging for user story 1 operations

**Story:** US1

- [ ] Add logging for user story 1 operations

**Checkpoint**: At this point, User Story 1 should be fully functional and testable independently

---

## Phase 4: User Story 2 - [Title] (Priority: P2)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 2 (OPTIONAL - only if tests requested) ⚠️

### Task 18: Contract test for [endpoint]

**Story:** US2 | **Parallel:** yes

**Files:**
- Create: `tests/contract/test_[name].py`

- [ ] Contract test for [endpoint]

### Task 19: Integration test for [user journey]

**Story:** US2 | **Parallel:** yes

**Files:**
- Create: `tests/integration/test_[name].py`

- [ ] Integration test for [user journey]

### Implementation for User Story 2

### Task 20: Create [Entity] model

**Story:** US2 | **Parallel:** yes

**Files:**
- Create: `src/models/[entity].py`

- [ ] Create [Entity] model

### Task 21: Implement [Service]

**Story:** US2

**Files:**
- Create: `src/services/[service].py`

- [ ] Implement [Service]

### Task 22: Implement [endpoint/feature]

**Story:** US2

**Files:**
- Create: `src/[location]/[file].py`

- [ ] Implement [endpoint/feature]

### Task 23: Integrate with User Story 1 components (if needed)

**Story:** US2

- [ ] Integrate with User Story 1 components (if needed)

**Checkpoint**: At this point, User Stories 1 AND 2 should both work independently

---

## Phase 5: User Story 3 - [Title] (Priority: P3)

**Goal**: [Brief description of what this story delivers]

**Independent Test**: [How to verify this story works on its own]

### Tests for User Story 3 (OPTIONAL - only if tests requested) ⚠️

### Task 24: Contract test for [endpoint]

**Story:** US3 | **Parallel:** yes

**Files:**
- Create: `tests/contract/test_[name].py`

- [ ] Contract test for [endpoint]

### Task 25: Integration test for [user journey]

**Story:** US3 | **Parallel:** yes

**Files:**
- Create: `tests/integration/test_[name].py`

- [ ] Integration test for [user journey]

### Implementation for User Story 3

### Task 26: Create [Entity] model

**Story:** US3 | **Parallel:** yes

**Files:**
- Create: `src/models/[entity].py`

- [ ] Create [Entity] model

### Task 27: Implement [Service]

**Story:** US3

**Files:**
- Create: `src/services/[service].py`

- [ ] Implement [Service]

### Task 28: Implement [endpoint/feature]

**Story:** US3

**Files:**
- Create: `src/[location]/[file].py`

- [ ] Implement [endpoint/feature]

**Checkpoint**: All user stories should now be independently functional

---

[Add more user story phases as needed, following the same pattern]

---

## Phase N: Polish & Cross-Cutting Concerns

**Purpose**: Improvements that affect multiple user stories

### Task 29: Documentation updates

**Parallel:** yes

**Files:**
- Modify: `docs/`

- [ ] Documentation updates in docs/

### Task 30: Code cleanup and refactoring

- [ ] Code cleanup and refactoring

### Task 31: Performance optimization across all stories

- [ ] Performance optimization across all stories

### Task 32: Additional unit tests (if requested)

**Parallel:** yes

**Files:**
- Create: `tests/unit/`

- [ ] Additional unit tests (if requested) in tests/unit/

### Task 33: Security hardening

- [ ] Security hardening

### Task 34: Run quickstart.md validation

- [ ] Run quickstart.md validation

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies - can start immediately
- **Foundational (Phase 2)**: Depends on Setup completion - BLOCKS all user stories
- **User Stories (Phase 3+)**: All depend on Foundational phase completion
  - User stories can then proceed in parallel (if staffed)
  - Or sequentially in priority order (P1 → P2 → P3)
- **Polish (Final Phase)**: Depends on all desired user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Can start after Foundational (Phase 2) - No dependencies on other stories
- **User Story 2 (P2)**: Can start after Foundational (Phase 2) - May integrate with US1 but should be independently testable
- **User Story 3 (P3)**: Can start after Foundational (Phase 2) - May integrate with US1/US2 but should be independently testable

### Within Each User Story

- Tests (if included) MUST be written and FAIL before implementation
- Models before services
- Services before endpoints
- Core implementation before integration
- Story complete before moving to next priority

### Parallel Opportunities

- All Setup tasks marked **Parallel: yes** can run in parallel
- All Foundational tasks marked **Parallel: yes** can run in parallel (within Phase 2)
- Once Foundational phase completes, all user stories can start in parallel (if team capacity allows)
- All tests for a user story marked **Parallel: yes** can run in parallel
- Models within a story marked **Parallel: yes** can run in parallel
- Different user stories can be worked on in parallel by different team members

---

## Parallel Example: User Story 1

```bash
# Launch all tests for User Story 1 together (if tests requested):
Task 10: Contract test for [endpoint]
Task 11: Integration test for [user journey]

# Launch all models for User Story 1 together:
Task 12: Create [Entity1] model
Task 13: Create [Entity2] model
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL - blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: Test User Story 1 independently
5. Deploy/demo if ready

### Incremental Delivery

1. Complete Setup + Foundational → Foundation ready
2. Add User Story 1 → Test independently → Deploy/Demo (MVP!)
3. Add User Story 2 → Test independently → Deploy/Demo
4. Add User Story 3 → Test independently → Deploy/Demo
5. Each story adds value without breaking previous stories

### Parallel Team Strategy

With multiple developers:

1. Team completes Setup + Foundational together
2. Once Foundational is done:
   - Developer A: User Story 1
   - Developer B: User Story 2
   - Developer C: User Story 3
3. Stories complete and integrate independently

---

## Notes

- **Parallel: yes** tasks = different files, no dependencies
- **Story** field maps a task to a specific user story for traceability
- Each user story should be independently completable and testable
- Verify tests fail before implementing
- Commit after each task or logical group
- Stop at any checkpoint to validate story independently
- Avoid: vague tasks, same file conflicts, cross-story dependencies that break independence
- Task numbers are sequential across the whole document and never reused or renumbered once written, since superpowers:subagent-driven-development locates a task by its number
