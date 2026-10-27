import { config } from '../config.js';
import { stitchSchemas } from './stitch.js';
import { ordersSubgraph } from './subgraphs/orders.js';
import { traceabilitySubgraph } from './subgraphs/traceability.js';
import { gatewaySubgraph } from './subgraphs/gateway.js';

/**
 * The executable gateway schema. Built once at process start; a stitching
 * failure is fatal and prevents the server from accepting traffic with a
 * partially composed schema.
 */
export const schema = stitchSchemas(
  [ordersSubgraph, traceabilitySubgraph, gatewaySubgraph],
  { version: config.version },
);

export const subgraphs = [ordersSubgraph, traceabilitySubgraph, gatewaySubgraph];
