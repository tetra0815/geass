# Error Code Definition Template

**Target**: `docs/api/error-handling.md`
**Note**: Keep `code` values in sync with `components/schemas/Error` in `openapi.yaml` and the error extensions in `graphql-schema.md` (to avoid maintaining the same thing twice — update both whenever a value changes).

## Error Code List

| code | HTTP Status | message | Retryable | Description |
|---|---|---|---|---|
| `VALIDATION_ERROR` | 400 | Invalid request parameters | No | Input validation failed |
| `UNAUTHORIZED` | 401 | Authentication required | No | Missing/invalid auth token |
| `FORBIDDEN` | 403 | Insufficient permissions | No | Not allowed per the permission matrix |
| `NOT_FOUND` | 404 | Resource not found | No | Target resource doesn't exist |
| `CONFLICT` | 409 | Resource state conflict | No | e.g. optimistic-lock collision |
| `RATE_LIMITED` | 429 | Too many requests | Yes (follow `Retry-After`) | Rate limit exceeded |
| `INTERNAL_ERROR` | 500 | Internal server error | Yes (exponential backoff) | Unexpected server error |
| `UPSTREAM_UNAVAILABLE` | 503 | Upstream service unavailable | Yes (exponential backoff) | Dependency outage |

## Retry Strategy

| Target | Max Attempts | Backoff | Circuit Breaker |
|---|---|---|---|
| External payment API | 3 | Exponential backoff (1s, 2s, 4s) | Opens after 5 consecutive failures, half-open after 30s |

## Fallback Behavior

| Scenario | Fallback |
|---|---|
| Recommendation service outage | Return the default popular-items list |
| Payment provider outage | Failover to an alternate provider (where applicable) |

## Design Notes

- Error messages returned to clients must not include internal implementation details (e.g. stack traces)
- When adding a new error code, update this table and `openapi.yaml`/`graphql-schema.md` together
