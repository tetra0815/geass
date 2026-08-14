# Permission Matrix Template

**Target**: `docs/security/access-control.md`
**Note**: Lists permissions as Role × Resource × Action. If the row count gets too large, group resources by domain.

## Permission Matrix (RBAC)

| Role | Resource | Create | Read | Update | Delete | Notes |
|---|---|---|---|---|---|---|
| Admin | User | ✅ | ✅ | ✅ | ✅ | Applies across all tenants |
| Editor | User | ❌ | ✅ | ✅ | ❌ | Own tenant only |
| Viewer | User | ❌ | ✅ | ❌ | ❌ | Own tenant only |
| Editor | Order | ✅ | ✅ | ✅ (only orders they created) | ❌ | |
| Viewer | Order | ❌ | ✅ | ❌ | ❌ | |

## Additional Attribute-Based Conditions (ABAC, where applicable)

List conditions that RBAC alone can't express (ownership checks, tenant boundaries, restrictions based on resource state, etc.).

| Role | Resource | Condition |
|---|---|---|
| Editor | Order | Update allowed only if `resource.ownerId == currentUser.id` |
| * | * | `resource.tenantId == currentUser.tenantId` is required on every operation (multi-tenant isolation) |

## Multi-Tenant / Multi-User Isolation Policy

- Where tenant boundaries are enforced (application layer / DB query layer / DB row-level security, etc.)
- Any special cases where cross-tenant access is allowed (document them, or write "none" if there are none)

## Design Notes

- Updating this matrix must be mandatory whenever a new Role or Resource is added (to prevent drift between implementation and documentation)
- Default to "implicit deny" — any combination not listed in the matrix is disallowed
