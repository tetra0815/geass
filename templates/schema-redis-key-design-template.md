# Redis Key Design Template

**Target**: Redis (cache, session store, queue, etc.)
**Note**: Redis has no relationships, so the primary design artifact is a "key design table" rather than an ER diagram.

## Key Design Table

| Key Pattern | Data Type | Fields / Members | TTL | Example | Purpose |
|---|---|---|---|---|---|
| `session:<sessionId>` | hash | user_id, expires_at, ip | 30 min | `session:abc123` | Holds session data |
| `cache:user:<userId>` | string (JSON) | - | 5 min | `cache:user:42` | Read-through cache for user info |
| `rank:daily:<date>` | sorted set | member=userId, score=points | 24 h | `rank:daily:2026-08-14` | Daily ranking |
| `queue:notifications` | list | JSON payload | none | `queue:notifications` | Notification job queue |
| `lock:order:<orderId>` | string | - | 10 sec | `lock:order:9001` | Mutex lock |

## Design Notes

- Namespace keys hierarchically with colons, e.g. `<domain>:<entity>:<id>`
- For keys without a TTL, document the eviction policy (make sure it's consistent with `maxmemory-policy`)
- Avoid overloading a single key with a large collection (list/set/zset/hash) — O(N) commands tend to become a bottleneck
- If using Pub/Sub or Streams (`XADD`, etc.), include the channel/stream naming convention here too
- In a cluster setup, note where key distribution needs to be pinned to a slot via hash tags (`{...}`)
