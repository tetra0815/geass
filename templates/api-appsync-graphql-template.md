# AppSync / GraphQL API Design Template

**Target**: AWS AppSync (GraphQL API)
**Note**: AppSync is an API layer, not a storage engine, so it's managed in this template separately from the underlying data-store design (e.g. DynamoDB access patterns). Refer to the store-side design in `docs/schema/storage-<name>.md` (`schema-dynamodb-access-patterns-template.md` for DynamoDB) and link to it from here by table name. For projects that also have REST APIs, use `endpoints.md` for the REST portion.

## Schema Definition

```graphql
type User {
  id: ID!
  email: String!
  orders: [Order!]! @aws_cognito_user_pools
}

type Order {
  id: ID!
  userId: ID!
  status: OrderStatus!
  items: [OrderItem!]!
  createdAt: AWSDateTime!
}

enum OrderStatus {
  PENDING
  SHIPPED
  DELIVERED
}

type Query {
  getUser(id: ID!): User @aws_cognito_user_pools
  listOrders(userId: ID!): [Order!]! @aws_cognito_user_pools
}

type Mutation {
  createOrder(input: CreateOrderInput!): Order @aws_cognito_user_pools
}

type Subscription {
  onOrderCreated(userId: ID!): Order
    @aws_subscribe(mutations: ["createOrder"])
}
```

## Resolver / Data Source Mapping

| Type.Field | Data Source | Referenced Table/API | Resolver Type | Authorization |
|---|---|---|---|---|
| `Query.getUser` | DynamoDB | User table in `storage-primary-db.md` | JS Resolver (Direct) | Cognito User Pools |
| `Query.listOrders` | DynamoDB | Order table in `storage-primary-db.md` (GSI1) | JS Resolver (Direct) | Cognito User Pools |
| `Mutation.createOrder` | Lambda | `create-order` function | Lambda Resolver | Cognito User Pools |
| `Order.items` | DynamoDB | OrderItem table in `storage-primary-db.md` | JS Resolver (Direct, BatchGetItem) | Inherited via pipeline |
| `Subscription.onOrderCreated` | None (attached to a Mutation) | - | - | Cognito User Pools |

## Authorization Modes

- Default authorization mode: (e.g. one of Cognito User Pools / API Key / IAM / OIDC / Lambda Authorizer)
- Note any field-level additional authorization (e.g. `@aws_iam` directives)
- If using an API Key, document its expiration and rotation policy

## Design Notes

- For places prone to N+1 issues (nested field resolution within lists), note whether a Batch Resolver / DataLoader pattern is applied
- If using Pipeline Resolvers, add each step's processing to the mapping table above
- Document any Subscription filter conditions (argument-based filtering)
- For error-handling details (e.g. GraphQL error extensions), see `docs/api/error-handling.md`
