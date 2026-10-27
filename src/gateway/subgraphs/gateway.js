import { config } from '../../config.js';

const typeDefs = /* GraphQL */ `
  type Query {
    gatewayInfo: GatewayInfo!
  }

  type GatewayInfo {
    name: String!
    version: String!
    uptimeSeconds: Int!
    startedAt: DateTime!
    strategy: String!
    stitchedAt: DateTime!
    subgraphs: [SubgraphInfo!]!
    dataCounts: DataCounts!
    limits: GatewayLimits!
    runtime: String!
  }

  type SubgraphInfo {
    name: String!
    typeCount: Int!
    resolverCount: Int!
    queryFields: [String!]!
    mutationFields: [String!]!
  }

  type DataCounts {
    orders: Int!
    suppliers: Int!
    products: Int!
    facilities: Int!
    shipments: Int!
    traceabilityRecords: Int!
    openOrders: Int!
    terminalOrders: Int!
  }

  type GatewayLimits {
    maxQueryDepth: Int!
    maxQueryFields: Int!
    rateLimitPerMinute: Int!
    bodyLimitBytes: Int!
  }
`;

const resolvers = {
  Query: {
    gatewayInfo: (_source, _args, ctx, info) => {
      const stitch = info.schema.stitch;
      return {
        name: 'Enterprise Supply Chain Traceability & Order Management Hub',
        version: config.version,
        uptimeSeconds: Math.max(0, Math.floor((Date.now() - Date.parse(config.startedAt)) / 1000)),
        startedAt: config.startedAt,
        strategy: stitch?.strategy ?? 'Single schema',
        stitchedAt: stitch?.stitchedAt ?? config.startedAt,
        subgraphs: stitch?.subgraphs ?? [],
        dataCounts: ctx.repo.counts(),
        limits: {
          maxQueryDepth: config.maxQueryDepth,
          maxQueryFields: config.maxQueryFields,
          rateLimitPerMinute: config.rateLimitMax,
          bodyLimitBytes: config.bodyLimitBytes,
        },
        runtime: `Node ${process.version}`,
      };
    },
  },
};

export const gatewaySubgraph = {
  name: 'gateway',
  typeDefs,
  resolvers,
};
