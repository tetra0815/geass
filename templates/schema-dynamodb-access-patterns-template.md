# DynamoDB Access Pattern Design Template

**Target**: DynamoDB (assumes a single-table design)
**Note**: DynamoDB has no foreign-key relationships, so the primary design artifact is an "access pattern table" rather than an ER diagram. First enumerate the application's query requirements (access patterns), then decide on a key design that satisfies them.

## Entity / Key Design Table

| Entity | PK | SK | GSI1PK | GSI1SK | Attributes |
|---|---|---|---|---|---|
| User | `USER#<userId>` | `PROFILE` | - | - | name, email, created_at |
| Order | `USER#<userId>` | `ORDER#<orderId>` | `ORDER#<orderId>` | `STATUS#<status>` | status, total, created_at |
| OrderItem | `ORDER#<orderId>` | `ITEM#<itemId>` | - | - | product_id, quantity, price |

## Access Pattern Table

| # | Access Pattern | Index | Key Condition | Notes |
|---|---|---|---|---|
| 1 | Get a user's profile | Table | `PK = USER#<userId> AND SK = PROFILE` | |
| 2 | List a user's orders | Table | `PK = USER#<userId> AND begins_with(SK, ORDER#)` | |
| 3 | List orders by status | GSI1 | `GSI1PK = ORDER#<orderId> AND begins_with(GSI1SK, STATUS#)` | |
| 4 | Get line items for an order | Table | `PK = ORDER#<orderId> AND begins_with(SK, ITEM#)` | |

## Design Notes

- Enumerate all access patterns from business requirements before filling in the table (adding patterns later tends to force a key-design rework)
- Keep GSIs to the minimum necessary (they directly drive cost and write amplification)
- If hot-partition mitigation is needed (e.g. adding a sharding key), note it here
- If using a TTL attribute, specify the target items and the retention period
