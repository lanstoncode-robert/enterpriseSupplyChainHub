import { verifyRecordChain } from '../../domain/traceability.js';
import { GraphQLError } from '../../graphql/errors.js';

const typeDefs = /* GraphQL */ `
  enum TraceEventType {
    HARVEST
    PRODUCTION
    PROCESSING
    QUALITY_CHECK
    PACKAGING
    DEPARTURE
    CUSTOMS_CLEARANCE
    ARRIVAL
    WAREHOUSE_RECEIPT
    DELIVERY
  }

  type PurchaseOrder {
    traceability: [TraceabilityRecord!]!
    chainVerified: Boolean!
    traceabilitySummary: TraceabilitySummary!
  }

  type TraceabilitySummary {
    recordCount: Int!
    verifiedCount: Int!
    invalidCount: Int!
    lastEventAt: DateTime
  }

  type TraceabilityRecord {
    id: ID!
    lotCode: String!
    serialRange: String!
    product: Product!
    supplier: Supplier!
    order: PurchaseOrder
    orderLineId: ID!
    quantity: Float!
    unit: String!
    harvestDate: DateTime
    bestBefore: DateTime
    facilityPath: [Facility!]!
    events: [TraceEvent!]!
    certificateRefs: [String!]!
    chainVerified: Boolean!
    verification: ChainVerification!
    createdAt: DateTime!
    updatedAt: DateTime!
  }

  type TraceEvent {
    id: ID!
    recordId: ID!
    sequence: Int!
    type: TraceEventType!
    occurredAt: DateTime!
    facility: Facility!
    actor: String!
    notes: String!
    documentRefs: [String!]!
    integrityHash: String!
    previousHash: String!
  }

  type ChainVerification {
    valid: Boolean!
    checkedEvents: Int!
    totalEvents: Int!
    brokenAt: ID
    expectedHash: String
    actualHash: String
    reason: String!
    verifiedAt: DateTime!
  }

  input TraceFilter {
    lotCode: String
    serial: String
    productId: ID
    supplierId: ID
    orderId: ID
    onlyInvalid: Boolean = false
  }

  input AppendTraceEventInput {
    recordId: ID!
    type: TraceEventType!
    facilityId: ID!
    actor: String!
    notes: String
    documentRefs: [String!]
    occurredAt: DateTime
  }

  extend type Query {
    traceabilityRecords(filter: TraceFilter, first: Int = 20): [TraceabilityRecord!]!
    traceabilityRecord(id: ID, lotCode: String): TraceabilityRecord
    verifyTraceRecord(id: ID, lotCode: String): ChainVerification
  }

  extend type Mutation {
    appendTraceEvent(input: AppendTraceEventInput!): TraceabilityRecord!
  }
`;

const resolvers = {
  Query: {
    traceabilityRecords: (_source, args, ctx) => ctx.repo.listTraceRecords(args),
    traceabilityRecord: (_source, args, ctx) => ctx.repo.findTraceRecord(args),
    verifyTraceRecord: (_source, args, ctx) => ctx.repo.verifyTraceRecord(args),
  },
  Mutation: {
    appendTraceEvent: (_source, args, ctx) => {
      if (ctx.config.readOnly) {
        throw new GraphQLError('Mutations are disabled because the deployment is in read-only mode.', {
          extensions: { code: 'READ_ONLY' },
        });
      }
      return ctx.repo.appendTraceEvent(args.input);
    },
  },
  PurchaseOrder: {
    traceability: (order, _args, ctx) => ctx.loaders.recordsForOrder(order.id),
    chainVerified: (order, _args, ctx) => {
      const records = ctx.loaders.recordsForOrder(order.id);
      return records.length > 0 && records.every((record) => verifyRecordChain(record).valid);
    },
    traceabilitySummary: (order, _args, ctx) => ctx.repo.getTraceabilitySummary(order.id),
  },
  TraceabilityRecord: {
    product: (record, _args, ctx) => ctx.loaders.product(record.productId),
    supplier: (record, _args, ctx) => ctx.loaders.supplier(record.supplierId),
    order: (record, _args, ctx) => ctx.loaders.order(record.orderId),
    facilityPath: (record, _args, ctx) => record.facilityIds.map((id) => ctx.loaders.facility(id)).filter(Boolean),
    events: (record) => [...record.events].sort((a, b) => a.sequence - b.sequence),
    chainVerified: (record) => verifyRecordChain(record).valid,
    verification: (record) => verifyRecordChain(record),
  },
  TraceEvent: {
    facility: (event, _args, ctx) => ctx.loaders.facility(event.facilityId),
  },
};

export const traceabilitySubgraph = {
  name: 'traceability',
  typeDefs,
  resolvers,
};
