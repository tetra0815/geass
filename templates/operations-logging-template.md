# Structured Logging Template

**Target**: `docs/operations/logging.md`

## Log Level Definitions

| Level | Use Case | Example |
|---|---|---|
| ERROR | Processing cannot continue, needs immediate attention | Request failure due to a failed call to an external API |
| WARN | Processing can continue but warrants attention | A retry occurred, use of a deprecated API |
| INFO | Key events in the normal flow | Request received, order confirmed, and other business events |
| DEBUG | Detailed information, enabled only during development | Variable contents, branch-condition details |

## Common Field Schema

Required fields that every log entry must include.

```json
{
  "timestamp": "2026-08-14T10:00:00.000Z",
  "level": "INFO",
  "service": "order-api",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "message": "order created",
  "context": {
    "order_id": "ord_123",
    "user_id": "usr_456"
  }
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `timestamp` | string (ISO 8601) | ✅ | Time the event occurred (UTC) |
| `level` | string | ✅ | Log level (per the definitions above) |
| `service` | string | ✅ | Name of the originating service/component |
| `trace_id` | string | ✅ | Distributed-tracing ID (makes a request traceable end to end) |
| `message` | string | ✅ | Human-readable summary |
| `context` | object | - | Event-specific structured data |

## Example Logs Per Event

For each business-critical event, define the contents of `context` concretely.

```json
{
  "timestamp": "2026-08-14T10:00:05.120Z",
  "level": "ERROR",
  "service": "order-api",
  "trace_id": "4bf92f3577b34da6a3ce929d0e0e4736",
  "message": "payment provider request failed",
  "context": {
    "order_id": "ord_123",
    "provider": "stripe",
    "error_code": "card_declined",
    "retry_count": 2
  }
}
```

## Sensitive Data Masking Policy

| Target | Policy |
|---|---|
| Passwords/tokens/API keys | Never log |
| Email addresses | (e.g. mask before logging, `us**@example.com`, or don't log at all) |
| Credit card information | Never log (PCI DSS compliance) |

## Design Notes

- Document how `trace_id` is generated and propagated (W3C Trace Context, X-Ray, etc.)
- Document where logs are stored and their retention period (CloudWatch Logs, Datadog, etc., and how many days)
- Updating the `context` field definitions in this document must be mandatory whenever a new event type is added
