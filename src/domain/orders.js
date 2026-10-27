export const ORDER_STATUSES = Object.freeze([
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'IN_PRODUCTION',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'DELIVERED',
  'CANCELLED',
  'ON_HOLD',
]);

export const OPEN_STATUSES = Object.freeze([
  'DRAFT',
  'PENDING_CONFIRMATION',
  'CONFIRMED',
  'IN_PRODUCTION',
  'PARTIALLY_SHIPPED',
  'SHIPPED',
  'ON_HOLD',
]);

export const TERMINAL_STATUSES = Object.freeze(['DELIVERED', 'CANCELLED']);

export const ORDER_TRANSITIONS = Object.freeze({
  DRAFT: ['PENDING_CONFIRMATION', 'CANCELLED'],
  PENDING_CONFIRMATION: ['CONFIRMED', 'CANCELLED', 'ON_HOLD'],
  CONFIRMED: ['IN_PRODUCTION', 'ON_HOLD', 'CANCELLED'],
  IN_PRODUCTION: ['PARTIALLY_SHIPPED', 'SHIPPED', 'ON_HOLD', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['SHIPPED', 'ON_HOLD'],
  SHIPPED: ['DELIVERED', 'ON_HOLD'],
  ON_HOLD: ['CONFIRMED', 'IN_PRODUCTION', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
});

export const STATUS_LABELS = Object.freeze({
  DRAFT: 'Draft',
  PENDING_CONFIRMATION: 'Pending confirmation',
  CONFIRMED: 'Confirmed',
  IN_PRODUCTION: 'In production',
  PARTIALLY_SHIPPED: 'Partially shipped',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  ON_HOLD: 'On hold',
});

export const RISK_LEVELS = Object.freeze(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

export const isOpenStatus = (status) => OPEN_STATUSES.includes(status);
export const isTerminalStatus = (status) => TERMINAL_STATUSES.includes(status);

export function allowedTransitions(status) {
  return ORDER_TRANSITIONS[status] ?? [];
}

export function canTransition(from, to) {
  return allowedTransitions(from).includes(to);
}

export function riskLevelForScore(score) {
  if (score >= 72) return 'CRITICAL';
  if (score >= 48) return 'HIGH';
  if (score >= 26) return 'MEDIUM';
  return 'LOW';
}

const SUPPLIER_RISK_BASE = { LOW: 7, MEDIUM: 23, HIGH: 45, CRITICAL: 65 };
const PRIORITY_RISK = { STANDARD: 0, HIGH: 8, CRITICAL: 16 };

/**
 * Transparent, explainable risk score. Every input is visible in the UI so
 * planners can see *why* an order is flagged instead of trusting a black box.
 */
export function computeOrderRisk(order, { supplier, shipments = [], traceRecords = [], now = new Date() } = {}) {
  if (TERMINAL_STATUSES.includes(order.status)) {
    return {
      score: 0,
      level: 'LOW',
      factors: [order.status === 'CANCELLED' ? 'Order cancelled; no active risk.' : 'Order delivered; no active risk.'],
    };
  }
  if (!supplier) return { score: 50, level: 'HIGH', factors: ['Supplier record missing'] };
  const factors = [];
  let score = SUPPLIER_RISK_BASE[supplier.riskLevel] ?? 20;
  factors.push(`Supplier risk ${supplier.riskLevel.toLowerCase()} (+${score})`);

  const priority = PRIORITY_RISK[order.priority] ?? 0;
  if (priority > 0) {
    score += priority;
    factors.push(`${order.priority.toLowerCase()} priority (+${priority})`);
  }

  const reliabilityPenalty = Math.round((1 - supplier.onTimeRate) * 30);
  if (reliabilityPenalty > 0) {
    score += reliabilityPenalty;
    factors.push(`Supplier on-time rate ${(supplier.onTimeRate * 100).toFixed(1)}% (+${reliabilityPenalty})`);
  }

  const maxDelay = shipments.reduce((max, shipment) => Math.max(max, shipment.delayHours ?? 0), 0);
  if (maxDelay > 0) {
    const delayPenalty = Math.min(18, 4 + Math.floor(maxDelay / 24) * 2);
    score += delayPenalty;
    factors.push(`${Math.round(maxDelay)}h shipment delay (+${delayPenalty})`);
  }

  if (!isTerminalStatus(order.status) && order.status !== 'DRAFT') {
    const expected = Date.parse(order.expectedDeliveryAt);
    if (Number.isFinite(expected) && expected < now.getTime()) {
      const daysLate = Math.ceil((now.getTime() - expected) / 86_400_000);
      const latePenalty = Math.min(22, daysLate * 2);
      score += latePenalty;
      factors.push(`${daysLate}d past expected delivery (+${latePenalty})`);
    }
    if (traceRecords.length === 0) {
      score += 9;
      factors.push('No traceability evidence (+9)');
    }
  }

  if (order.status === 'ON_HOLD') {
    score += 7;
    factors.push('Order on hold (+7)');
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)));
  return { score: clamped, level: riskLevelForScore(clamped), factors };
}
