# Mock/Stub Strategy & Test Data Management Template

**Target**: `docs/testing/local-testing.md`
**Note**: Project-wide policy such as test-type strategy (unit/integration/E2E) and coverage targets is defined in the Constitution. This document covers only the implementation-level detail of what gets replaced when writing tests, and how.

## Mock/Stub Strategy

| Target | Boundary Replaced | Method | Rationale |
|---|---|---|---|
| External payment API | HTTP client layer | MSW (Mock Service Worker) | Exercise response patterns (success/failure/timeout) exhaustively without hitting the real API |
| Primary DB | Repository-layer interface | Test Containers (spin up a real DB) | Query correctness needs to be verified including ORM behavior, so a real DB is used instead of a fake |
| Clock | `Clock` interface | Fake clock implementation | Makes tests for expiration/scheduling deterministic |
| Queue/event bus | Publisher interface | In-memory fake implementation | Lets async publishing be verified synchronously |

## Test Data Management

| Item | Policy |
|---|---|
| Fixture location | (e.g. `tests/fixtures/`, generated via a factory pattern) |
| Seed data | (e.g. `seed.ts` loads only the minimal master data) |
| Use of production data | (e.g. prohibited — not even anonymized; or allowed in staging only — document the policy) |
| Data isolation between tests | (e.g. transaction rollback per test, or a dedicated schema) |

## Design Notes

- Mock boundaries (interfaces) should match the DI design in the implementation code — the boundaries decided here determine how testable the implementation is
- If using something that spins up a real process (e.g. Test Containers), document its impact on CI run time
