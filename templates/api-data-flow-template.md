# Data Flow Design Template

**Target**: `docs/api/data-flow.md`

## Data Flow Between Components (Mermaid)

```mermaid
flowchart LR
    Client -->|HTTPS| APIGateway
    APIGateway -->|sync| OrderService
    OrderService -->|sync, write| PrimaryDB[(Primary DB)]
    OrderService -->|async, publish| EventBus{{Event Bus}}
    EventBus -->|async| NotificationWorker
    EventBus -->|async| AnalyticsWorker
    NotificationWorker -->|sync| EmailProvider
```

## Sync/Async Pattern Inventory

| Flow | Type | Rationale |
|---|---|---|
| Client → APIGateway → OrderService | Sync | The user needs the result back immediately |
| OrderService → EventBus → NotificationWorker | Async | Email delivery delay doesn't affect user experience |

## Error-Handling Flow (Mermaid)

```mermaid
flowchart LR
    A[OrderService: DB write] -->|failure| B{Retryable?}
    B -->|Yes| C[Retry with exponential backoff]
    C -->|max attempts reached| D[Send to DLQ]
    B -->|No| D
    D --> E[Fire alert]
```

## Design Notes

- Document the max retry count and backoff strategy for each async process (see `error-handling.md` for details)
- Document which operations require idempotency (handling duplicate message delivery)
- If there are many components, feel free to split the flow diagram by use case
