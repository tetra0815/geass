# Screen Design Template

**Target**: `docs/client/screen-<name>.md` (one file per screen, as many as needed)
**Note**: The screen inventory and screen transitions are managed in `ui-ux.md`. This file focuses on a single screen's internal design (component usage and event behavior).

## Screen Info

- **Screen name**: Order list
- **Path**: `/orders`
- **Corresponding endpoint in `openapi.yaml` / `graphql-schema.md`**: `GET /orders`

## Components Used

| Component | Purpose | Shared/Screen-specific |
|---|---|---|
| Header | Shared header | Shared |
| NavBar | Navigation | Shared |
| OrderListItem | Renders a single order | Screen-specific |
| Pagination | Page navigation | Shared |
| Footer | Shared footer | Shared |

## Events & Behavior

| Event | Trigger | Behavior |
|---|---|---|
| Screen shown | Page load | Call `GET /orders`, show a loading spinner → show the list on success, show an error message on failure |
| Order item tapped | Click on `OrderListItem` | Navigate to order detail (`/orders/:orderId`) |
| Pagination clicked | Click on `Pagination` | Call `GET /orders?page=N` and replace the list |
| Search submitted | Search form submit | Call `GET /orders?q=...`, show loading → replace results |

## Design Notes

- Map the API each event calls to the `operationId` in `docs/api/openapi.yaml`
- Document the display states while waiting on an API response — loading, error, empty state, etc.
- For operations using optimistic updates, document that behavior and the rollback method on failure
