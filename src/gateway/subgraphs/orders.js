import { allowedTransitions, isOpenStatus, isTerminalStatus } from '../../domain/orders.js';

const typeDefs = /* GraphQL */ `
  scalar DateTime

  enum OrderStatus {
    DRAFT
    PENDING_CONFIRMATION
    CONFIRMED
    IN_PRODUCTION
    PARTIALLY_SHIPPED
    SHIPPED
    DELIVERED
    CANCELLED
    ON_HOLD
  }

  enum Priority { STANDARD HIGH CRITICAL }

  enum RiskLevel { LOW MEDIUM HIGH CRITICAL }

  enum LineStatus { PENDING IN_PRODUCTION READY SHIPPED RECEIVED CANCELLED }

  enum SortDirection { ASC DESC }

  enum OrderSortField { CREATED_AT EXPECTED_DELIVERY TOTAL_VALUE RISK }

  enum ShipmentStatus { PLANNED BOOKED IN_TRANSIT DELAYED DELIVERED EXCEPTION }

  enum TransportMode { SEA AIR ROAD RAIL }

  enum FacilityType { PLANT PORT DC FARM }

  type Query {
    orders(filter: OrderFilter, sort: OrderSort, first: Int = 20, after: String): OrderConnection!
    order(id: ID, poNumber: String): PurchaseOrder
    products(search: String, category: String, supplierId: ID, first: Int = 50): [Product!]!
    product(id: ID!): Product
    suppliers(search: String, riskLevel: [RiskLevel!]): [Supplier!]!
    supplier(id: ID!): Supplier
    facilities: [Facility!]!
    shipment(id: ID!): Shipment
    metrics(months: Int = 6): Metrics!
  }

  type Mutation {
    createPurchaseOrder(input: CreatePurchaseOrderInput!): PurchaseOrder!
    updateOrderStatus(input: UpdateOrderStatusInput!): PurchaseOrder!
  }

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
    field: OrderSortField! = CREATED_AT
    direction: SortDirection! = DESC
  }

  input CreatePurchaseOrderInput {
    supplierId: ID!
    buyer: String!
    priority: Priority = STANDARD
    incoterms: String = "FOB"
    expectedDeliveryAt: DateTime!
    notes: String
    lines: [CreateOrderLineInput!]!
  }

  input CreateOrderLineInput {
    productId: ID!
    quantity: Int!
    unitPrice: Float
  }

  input UpdateOrderStatusInput {
    orderId: ID!
    status: OrderStatus!
    note: String
  }

  type PageInfo {
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
    startCursor: String
    endCursor: String
  }

  type OrderAggregates {
    totalValue: Float!
    atRiskCount: Int!
    openCount: Int!
  }

  type OrderConnection {
    nodes: [PurchaseOrder!]!
    totalCount: Int!
    pageInfo: PageInfo!
    aggregates: OrderAggregates!
  }

  type PurchaseOrder {
    id: ID!
    poNumber: String!
    status: OrderStatus!
    supplier: Supplier!
    buyer: String!
    destination: Facility
    priority: Priority!
    currency: String!
    incoterms: String!
    totalValue: Float!
    createdAt: DateTime!
    expectedDeliveryAt: DateTime!
    updatedAt: DateTime!
    deliveredAt: DateTime
    notes: String
    lines: [OrderLine!]!
    lineCount: Int!
    shipments: [Shipment!]!
    riskScore: Int!
    riskLevel: RiskLevel!
    riskFactors: [String!]!
    isOpen: Boolean!
    daysUntilDue: Int
    statusHistory: [StatusChange!]!
    allowedTransitions: [OrderStatus!]!
  }

  type StatusChange {
    status: OrderStatus!
    at: DateTime!
    note: String
  }

  type OrderLine {
    id: ID!
    lineNumber: Int!
    product: Product!
    quantity: Int!
    unitPrice: Float!
    lineTotal: Float!
    receivedQuantity: Int!
    backorderQuantity: Int!
    status: LineStatus!
  }

  type Supplier {
    id: ID!
    name: String!
    country: String!
    region: String!
    tier: Int!
    riskLevel: RiskLevel!
    certifications: [String!]!
    contactEmail: String!
    onTimeRate: Float!
    leadTimeDays: Int!
    activeOrders: Int!
    products: [Product!]!
  }

  type Product {
    id: ID!
    sku: String!
    name: String!
    category: String!
    uom: String!
    unitPrice: Float!
    supplier: Supplier!
    originFacility: Facility!
    hsCode: String!
    sustainability: Sustainability!
  }

  type Sustainability {
    recycledContentPct: Int!
    carbonKgPerUnit: Float!
    certifications: [String!]!
  }

  type Facility {
    id: ID!
    name: String!
    type: FacilityType!
    country: String!
    city: String!
  }

  type Shipment {
    id: ID!
    trackingNumber: String!
    carrier: String!
    mode: TransportMode!
    status: ShipmentStatus!
    order: PurchaseOrder!
    origin: Facility!
    destination: Facility!
    departedAt: DateTime!
    estimatedArrivalAt: DateTime!
    deliveredAt: DateTime
    delayHours: Int!
    temperatureControlled: Boolean!
    milestones: [ShipmentMilestone!]!
  }

  type ShipmentMilestone {
    status: String!
    occurredAt: DateTime!
    location: String!
    note: String
  }

  type Metrics {
    totalOrders: Int!
    openOrders: Int!
    onTimeDeliveryRate: Float!
    averageLeadTimeDays: Float!
    totalSpend: Float!
    atRiskOrders: Int!
    traceabilityCoveragePct: Float!
    byStatus: [StatusCount!]!
    byRegion: [RegionSpend!]!
    spendTrend: [TrendPoint!]!
    topSuppliers: [SupplierScore!]!
    riskDistribution: [RiskCount!]!
    chainIntegrity: ChainIntegrity!
    lastUpdated: DateTime!
    currency: String!
  }

  type StatusCount { status: OrderStatus! count: Int! }
  type RegionSpend { region: String! spend: Float! orders: Int! }
  type TrendPoint { month: String! spend: Float! orders: Int! }
  type SupplierScore { supplier: Supplier! spend: Float! orderCount: Int! onTimeRate: Float! }
  type RiskCount { level: RiskLevel! count: Int! }
  type ChainIntegrity { valid: Int! invalid: Int! totalRecords: Int! verifiedAt: DateTime! }
`;

const resolvers = {
  Query: {
    orders: (_source, args, ctx) => ctx.repo.listOrders(args),
    order: (_source, args, ctx) => ctx.repo.getOrderByReference(args),
    products: (_source, args, ctx) => ctx.repo.listProducts(args),
    product: (_source, args, ctx) => ctx.repo.getProduct(args.id),
    suppliers: (_source, args, ctx) => ctx.repo.listSuppliers(args),
    supplier: (_source, args, ctx) => ctx.repo.getSupplier(args.id),
    facilities: (_source, _args, ctx) => ctx.repo.listFacilities(),
    shipment: (_source, args, ctx) => ctx.repo.getShipment(args.id),
    metrics: (_source, args, ctx) => ctx.repo.metrics(args),
  },
  Mutation: {
    createPurchaseOrder: (_source, args, ctx) => {
      if (ctx.config.readOnly) throw new Error('Mutations are disabled because the deployment is in read-only mode.');
      return ctx.repo.createOrder(args.input);
    },
    updateOrderStatus: (_source, args, ctx) => {
      if (ctx.config.readOnly) throw new Error('Mutations are disabled because the deployment is in read-only mode.');
      return ctx.repo.updateOrderStatus(args.input);
    },
  },
  PurchaseOrder: {
    supplier: (order, _args, ctx) => ctx.loaders.supplier(order.supplierId),
    destination: (order, _args, ctx) => (order.destinationFacilityId ? ctx.loaders.facility(order.destinationFacilityId) : null),
    lines: (order) => order.lines,
    lineCount: (order) => order.lines.length,
    shipments: (order, _args, ctx) => order.shipmentIds.map((id) => ctx.loaders.shipment(id)).filter(Boolean),
    riskScore: (order, _args, ctx) => ctx.repo.riskForOrder(order).score,
    riskLevel: (order, _args, ctx) => ctx.repo.riskForOrder(order).level,
    riskFactors: (order, _args, ctx) => ctx.repo.riskForOrder(order).factors,
    isOpen: (order) => isOpenStatus(order.status),
    daysUntilDue: (order) => {
      if (isTerminalStatus(order.status)) return null;
      return Math.ceil((Date.parse(order.expectedDeliveryAt) - Date.now()) / 86_400_000);
    },
    statusHistory: (order) => order.statusHistory ?? [
      { status: order.status, at: order.updatedAt, note: 'Imported status snapshot from the ERP system of record.' },
    ],
    allowedTransitions: (order) => allowedTransitions(order.status),
  },
  OrderLine: {
    product: (line, _args, ctx) => ctx.loaders.product(line.productId),
    lineTotal: (line) => Math.round(line.quantity * line.unitPrice * 100) / 100,
    backorderQuantity: (line) => Math.max(0, line.quantity - (line.receivedQuantity ?? 0)),
  },
  Supplier: {
    products: (supplier, _args, ctx) => ctx.repo.productsForSupplier(supplier.id),
    activeOrders: (supplier, _args, ctx) => ctx.repo.activeOrderCountForSupplier(supplier.id),
  },
  Product: {
    supplier: (product, _args, ctx) => ctx.loaders.supplier(product.supplierId),
    originFacility: (product, _args, ctx) => ctx.loaders.facility(product.originFacilityId),
  },
  Shipment: {
    order: (shipment, _args, ctx) => ctx.loaders.order(shipment.orderId),
    origin: (shipment, _args, ctx) => ctx.loaders.facility(shipment.originFacilityId),
    destination: (shipment, _args, ctx) => ctx.loaders.facility(shipment.destinationFacilityId),
  },
};

export const ordersSubgraph = {
  name: 'orders',
  typeDefs,
  resolvers,
};
