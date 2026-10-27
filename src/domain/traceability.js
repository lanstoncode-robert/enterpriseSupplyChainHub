import { GENESIS_HASH, canonicalize, randomId, sha256Hex } from '../lib/ids.js';

export const TRACE_EVENT_TYPES = Object.freeze([
  'HARVEST',
  'PRODUCTION',
  'PROCESSING',
  'QUALITY_CHECK',
  'PACKAGING',
  'DEPARTURE',
  'CUSTOMS_CLEARANCE',
  'ARRIVAL',
  'WAREHOUSE_RECEIPT',
  'DELIVERY',
]);

export const TRACE_EVENT_LABELS = Object.freeze({
  HARVEST: 'Harvest',
  PRODUCTION: 'Production',
  PROCESSING: 'Processing',
  QUALITY_CHECK: 'Quality check',
  PACKAGING: 'Packaging',
  DEPARTURE: 'Departure',
  CUSTOMS_CLEARANCE: 'Customs clearance',
  ARRIVAL: 'Arrival',
  WAREHOUSE_RECEIPT: 'Warehouse receipt',
  DELIVERY: 'Delivery',
});

/**
 * The fields covered by an event's integrity hash. Hashes deliberately exclude
 * previousHash/integrityHash to avoid self-reference; the previous hash is
 * mixed into the digest instead, forming a tamper-evident chain.
 */
export function eventPayload(event) {
  return {
    id: event.id,
    recordId: event.recordId,
    sequence: event.sequence,
    type: event.type,
    occurredAt: event.occurredAt,
    facilityId: event.facilityId,
    actor: event.actor,
    notes: event.notes ?? '',
    documentRefs: event.documentRefs ?? [],
  };
}

export function computeEventHash(previousHash, event) {
  return sha256Hex(`${previousHash}\n${canonicalize(eventPayload(event))}`);
}

export function buildEvent({ recordId, sequence, previousHash, type, occurredAt, facilityId, actor, notes = '', documentRefs = [], id }) {
  const event = {
    id: id ?? randomId('EVT-'),
    recordId,
    sequence,
    type,
    occurredAt,
    facilityId,
    actor,
    notes,
    documentRefs,
    previousHash,
  };
  event.integrityHash = computeEventHash(previousHash, event);
  return event;
}

/**
 * Recomputes the whole chain. Returns a structured result so the UI can point
 * at the exact event where integrity broke instead of a vague failure.
 */
export function verifyRecordChain(record) {
  const events = [...(record.events ?? [])].sort((a, b) => a.sequence - b.sequence);
  if (events.length === 0) {
    return {
      valid: false,
      checkedEvents: 0,
      totalEvents: 0,
      brokenAt: null,
      expectedHash: null,
      actualHash: null,
      reason: 'The record has no chain-of-custody events.',
      verifiedAt: new Date().toISOString(),
    };
  }

  let previousHash = GENESIS_HASH;
  for (let index = 0; index < events.length; index += 1) {
    const event = events[index];
    if (event.sequence !== index + 1) {
      return {
        valid: false,
        checkedEvents: index,
        totalEvents: events.length,
        brokenAt: event.id,
        expectedHash: null,
        actualHash: event.integrityHash ?? null,
        reason: `Event ${event.id} is out of sequence (expected ${index + 1}, found ${event.sequence}).`,
        verifiedAt: new Date().toISOString(),
      };
    }
    if (event.previousHash !== previousHash) {
      return {
        valid: false,
        checkedEvents: index,
        totalEvents: events.length,
        brokenAt: event.id,
        expectedHash: previousHash,
        actualHash: event.previousHash ?? null,
        reason: `Event ${event.id} does not reference the previous event hash.`,
        verifiedAt: new Date().toISOString(),
      };
    }
    const expected = computeEventHash(previousHash, event);
    if (expected !== event.integrityHash) {
      return {
        valid: false,
        checkedEvents: index,
        totalEvents: events.length,
        brokenAt: event.id,
        expectedHash: expected,
        actualHash: event.integrityHash ?? null,
        reason: `Event ${event.id} (${TRACE_EVENT_LABELS[event.type] ?? event.type}) failed integrity verification.`,
        verifiedAt: new Date().toISOString(),
      };
    }
    previousHash = event.integrityHash;
  }

  return {
    valid: true,
    checkedEvents: events.length,
    totalEvents: events.length,
    brokenAt: null,
    expectedHash: previousHash,
    actualHash: previousHash,
    reason: `All ${events.length} events verified against the recorded chain.`,
    verifiedAt: new Date().toISOString(),
  };
}

export function appendEventToRecord(record, input, { now = new Date() } = {}) {
  const events = [...(record.events ?? [])].sort((a, b) => a.sequence - b.sequence);
  const last = events[events.length - 1];
  const sequence = (last?.sequence ?? 0) + 1;
  const occurredAt = input.occurredAt ?? now.toISOString();
  if (Number.isNaN(Date.parse(occurredAt))) {
    throw new Error('occurredAt must be an ISO-8601 timestamp.');
  }
  if (last && Date.parse(occurredAt) < Date.parse(last.occurredAt)) {
    throw new Error('A trace event cannot occur before the previous event in the chain.');
  }
  const event = buildEvent({
    recordId: record.id,
    sequence,
    previousHash: last?.integrityHash ?? GENESIS_HASH,
    type: input.type,
    occurredAt: new Date(occurredAt).toISOString(),
    facilityId: input.facilityId,
    actor: input.actor,
    notes: input.notes ?? '',
    documentRefs: input.documentRefs ?? [],
  });
  events.push(event);
  record.events = events;
  record.updatedAt = now.toISOString();
  return { event, record };
}
