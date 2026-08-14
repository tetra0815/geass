# Data Format / Event Schema Template

**Target**: `docs/schema/data-formats.md`

## Event/Message Schema (JSON Schema)

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://example.com/schemas/order-created.json",
  "title": "OrderCreated",
  "type": "object",
  "required": ["event_id", "event_type", "occurred_at", "data"],
  "properties": {
    "event_id": { "type": "string", "format": "uuid" },
    "event_type": { "type": "string", "const": "order.created" },
    "occurred_at": { "type": "string", "format": "date-time" },
    "data": {
      "type": "object",
      "required": ["order_id", "user_id"],
      "properties": {
        "order_id": { "type": "string" },
        "user_id": { "type": "string" },
        "total": { "type": "number" }
      }
    }
  }
}
```

## Message Type Inventory

| Event Type | Schema | Producer | Consumer | Delivery Guarantee |
|---|---|---|---|---|
| `order.created` | `events/order-created.json` | order-api | notification-worker, analytics-worker | at-least-once |

## ID Generation Strategy

| Target | Method | Example | Rationale |
|---|---|---|---|
| Entity ID | UUIDv4 | `550e8400-e29b-41d4-a716-446655440000` | Collision-free even under distributed generation |
| Event ID | ULID | `01ARZ3NDEKTSV4RRFFQ69G5FAV` | Sortable by time and collision-free |

## Storage Format

| Use Case | Format | Rationale |
|---|---|---|
| Archival logs | Parquet | Optimized for columnar reads in analytical queries |
| Event store | JSON | Prioritizes ease of schema evolution |

## Design Notes

- Document the backward-compatibility policy for schemas (e.g. adding fields is allowed, removing/retyping fields is a breaking change)
- Document the schema versioning approach (e.g. embed the version in `event_type`, or in `$id`)
