# GraphQL API

Endpoint: `POST /graphql` (JSON only). Schema: `GET /graphql/schema.graphql` or `/graphql/schema.json`.

```json
{ "query": "...", "variables": {}, "operationName": null }
```

- Auth: `Authorization: Bearer <API_TOKEN>` when configured.
- Body limit: 256 KB (configurable). Query length: 60 KB. Depth: 12. Fields: 500.
- Rate limit: 120 requests/minute/IP by default; `429` includes `Retry-After`.
- All timestamps are ISO-8601 UTC. All monetary values are USD.

---

## Root queries

| Field | Arguments | Returns |
| --- | --- | --- |
| `orders` | `filter`, `sort`, `first = 20`, `after` | `OrderConnection!` |
| `order` | `id` or `poNumber` | `PurchaseOrder` |
| `products` | `search`, `category`, `supplierId`, `first = 50` | `[Product!]!` |
| `product` | `id!` | `Product` |
| `suppliers` | `search`, `riskLevel` | `[Supplier!]!` |
| `supplier` | `id!` | `Supplier` |
| `facilities` | — | `[Facility!]!` |
| `shipment` | `id!` | `Shipment` |
| `metrics` | `months = 6` | `Metrics!` |
| `traceabilityRecords` | `filter`, `first = 20` | `[TraceabilityRecord!]!` |
| `traceabilityRecord` | `id` or `lotCode` | `TraceabilityRecord` |
| `verifyTraceRecord` | `id` or `lotCode` | `ChainVerification` |
| `gatewayInfo` | — | `GatewayInfo!` |

### Order filters and sorting

```graphql
input OrderFilter {
  search: String
  status: [OrderStatus!]
  riskLevel: [RiskLevel!]
  priority: [Priority!]
  supplierId: ID
  buyer: String
  createdFrom: DateTime
  createdTo: DateTime
}

input OrderSort {
  field: OrderSortField! = CREATED_AT   # CREATED_AT | EXPECTED_DELIVERY | TOTAL_VALUE | RISK
  direction: SortDirection! = DESC      # ASC | DESC
}
```

Enums: `OrderStatus` = `DRAFT`, `PENDING_CONFIRMATION`, `CONFIRMED`, `IN_PRODUCTION`, `PARTIALLY_SHIPPED`, `SHIPPED`, `DELIVERED`, `CANCELLED`, `ON_HOLD`. `RiskLevel` = `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`. `Priority` = `STANDARD`, `HIGH`, `CRITICAL`.

### Pagination

```graphql
query {
  orders(first: 15, after: null) {
    totalCount
    aggregates { totalValue atRiskCount openCount }
    pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
    nodes { poNumber }
  }
}
```

Send `pageInfo.endCursor` as `after` for the next page. Cursors are opaque base64url strings.

### Order detail

```graphql
query Order($poNumber: String!) {
  order(poNumber: $poNumber) {
    poNumber status priority buyer currency incoterms totalValue
    createdAt expectedDeliveryAt updatedAt deliveredAt notes
    riskScore riskLevel riskFactors isOpen daysUntilDue allowedTransitions
    supplier { name country region riskLevel onTimeRate leadTimeDays certifications }
    destination { name city country }
    lines {
      product { sku name category uom }
      quantity receivedQuantity backorderQuantity unitPrice lineTotal status
    }
    shipments {
      carrier trackingNumber mode status delayHours temperatureControlled
      origin { name } destination { name }
      milestones { status occurredAt location note }
    }
    traceability {
      lotCode chainVerified
      verification { valid reason checkedEvents totalEvents brokenAt }
    }
    statusHistory { status at note }
  }
}
```

### Metrics

```graphql
query {
  metrics(months: 6) {
    totalOrders openOrders onTimeDeliveryRate averageLeadTimeDays totalSpend atRiskOrders
    traceabilityCoveragePct currency lastUpdated
    byStatus { status count }
    byRegion { region spend orders }
    spendTrend { month spend orders }
    topSuppliers { supplier { name } spend orderCount onTimeRate }
    riskDistribution { level count }
    chainIntegrity { valid invalid totalRecords verifiedAt }
  }
}
```

### Traceability

```graphql
query Trace($lotCode: String!) {
  traceabilityRecord(lotCode: $lotCode) {
    lotCode serialRange quantity unit harvestDate bestBefore chainVerified
    product { name sku }
    supplier { name country }
    order { poNumber status }
    facilityPath { name city country type }
    events {
      sequence type occurredAt actor notes documentRefs
      facility { name city }
      integrityHash previousHash
    }
    verification { valid reason checkedEvents totalEvents brokenAt expectedHash actualHash verifiedAt }
    certificateRefs
  }
}
```

`TraceFilter`: `lotCode`, `serial`, `productId`, `supplierId`, `orderId`, `onlyInvalid`.

---

## Mutations

### Create a draft order

```graphql
mutation Create($input: CreatePurchaseOrderInput!) {
  createPurchaseOrder(input: $input) {
    id poNumber status totalValue
    lines { product { name } quantity unitPrice }
    allowedTransitions
  }
}
```

```json
{
  "input": {
    "supplierId": "SUP-KAVERI",
    "buyer": "Textiles EU",
    "priority": "HIGH",
    "incoterms": "FOB",
    "expectedDeliveryAt": "2026-12-15T12:00:00.000Z",
    "notes": "Q4 replenishment",
    "lines": [
      { "productId": "PRD-1001", "quantity": 500 },
      { "productId": "PRD-1003", "quantity": 120, "unitPrice": 15.5 }
    ]
  }
}
```

Rules:

- supplier must exist; every product must belong to that supplier
- 1–20 lines; quantity 1–100,000; unit price finite and non-negative
- expected date no more than one day in the past
- totals are computed server-side; the order starts in `DRAFT`

### Update order status

```graphql
mutation ($input: UpdateOrderStatusInput!) {
  updateOrderStatus(input: $input) { poNumber status allowedTransitions updatedAt }
}
```

```json
{ "input": { "orderId": "PO-1045", "status": "SHIPPED", "note": "Handed to carrier" } }
```

Allowed transitions:

```text
DRAFT                → PENDING_CONFIRMATION, CANCELLED
PENDING_CONFIRMATION → CONFIRMED, ON_HOLD, CANCELLED
CONFIRMED            → IN_PRODUCTION, ON_HOLD, CANCELLED
IN_PRODUCTION        → PARTIALLY_SHIPPED, SHIPPED, ON_HOLD, CANCELLED
PARTIALLY_SHIPPED    → SHIPPED, ON_HOLD
SHIPPED              → DELIVERED, ON_HOLD
ON_HOLD              → CONFIRMED, IN_PRODUCTION, CANCELLED
DELIVERED, CANCELLED → terminal
```

### Append a chain-of-custody event

```graphql
mutation Append($input: AppendTraceEventInput!) {
  appendTraceEvent(input: $input) {
    lotCode chainVerified
    verification { valid reason checkedEvents totalEvents }
  }
}
```

```json
{
  "input": {
    "recordId": "TRC-3004",
    "type": "QUALITY_CHECK",
    "facilityId": "FAC-ROTTERDAM",
    "actor": "Quality Lab",
    "notes": "Additional moisture test",
    "documentRefs": ["LAB-2026-5512"],
    "occurredAt": "2026-10-24T10:00:00.000Z"
  }
}
```

`TraceEventType`: `HARVEST`, `PRODUCTION`, `PROCESSING`, `QUALITY_CHECK`, `PACKAGING`, `DEPARTURE`, `CUSTOMS_CLEARANCE`, `ARRIVAL`, `WAREHOUSE_RECEIPT`, `DELIVERY`.

`occurredAt` cannot be in the future or before the previous event. The new hash commits to the previous digest.

---

## Errors

GraphQL responses use HTTP 200 and a standard `errors` array:

```json
{
  "data": null,
  "errors": [
    {
      "message": "Cannot move order from DRAFT to SHIPPED. Allowed next status: PENDING_CONFIRMATION, CANCELLED.",
      "locations": [{ "line": 1, "column": 60 }],
      "extensions": { "code": "BAD_USER_INPUT" }
    }
  ],
  "extensions": { "requestId": "...", "durationMs": 3.2 }
}
```

Common codes: `GRAPHQL_PARSE_FAILED`, `GRAPHQL_VALIDATION_FAILED`, `BAD_USER_INPUT`, `QUERY_TOO_COMPLEX`, `QUERY_TOO_LARGE`, `UNAUTHORIZED`, `RATE_LIMITED`, `READ_ONLY`, `INTERNAL_SERVER_ERROR`.

HTTP 4xx is used for malformed HTTP requests (bad JSON, wrong content type, oversized body, method not allowed, CORS denial), not for GraphQL execution errors.

---

## Authentication

Set `API_TOKEN` and send:

```http
Authorization: Bearer <token>
```

The browser client stores it in `sessionStorage` after you enter it in the key dialog. Health, readiness, static assets, and schema endpoints are public; `/graphql` is protected. There is no per-user identity or RBAC in this build.

---

## Feature limits

- No introspection (`__schema`, `__type`). Use `/graphql/schema.json` or the SDL.
- No subscriptions.
- No interfaces or unions.
- No persisted queries or batching.
- Single datastore writer.
