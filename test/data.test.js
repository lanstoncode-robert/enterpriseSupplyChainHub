import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { config } from '../src/config.js';
import { buildSeedData } from '../src/data/seed.js';
import { JsonStore } from '../src/data/store.js';
import { createRepository } from '../src/data/repository.js';
import { verifyRecordChain } from '../src/domain/traceability.js';
import { computeOrderRisk } from '../src/domain/orders.js';

async function tempDir() {
  return mkdtemp(path.join(config.rootDir, '.tmp-data-test-'));
}

test('seed data is internally consistent and reproducible', async () => {
  const now = new Date('2026-10-24T12:00:00.000Z');
  const first = buildSeedData(now);
  const second = buildSeedData(now);
  assert.equal(first.orders.length, 52);
  assert.equal(first.suppliers.length, 7);
  assert.equal(first.products.length, 14);
  assert.ok(first.traceabilityRecords.length > 30);
  assert.deepEqual(first.orders.map((order) => order.id), second.orders.map((order) => order.id));
  assert.deepEqual(first.orders.map((order) => order.poNumber), second.orders.map((order) => order.poNumber));

  for (const collection of ['suppliers', 'facilities', 'products', 'orders', 'shipments', 'traceabilityRecords']) {
    const ids = first[collection].map((item) => item.id);
    assert.equal(new Set(ids).size, ids.length, `${collection} IDs must be unique`);
  }
  for (const order of first.orders) {
    const total = Math.round(order.lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0) * 100) / 100;
    assert.ok(Math.abs(total - order.totalValue) < 0.011, `${order.poNumber} total should match its lines`);
    assert.equal(order.currency, 'USD');
  }
  for (const shipment of first.shipments) {
    if (shipment.status === 'DELAYED') assert.ok(shipment.delayHours > 0);
    if (shipment.status === 'DELIVERED') assert.ok(shipment.deliveredAt);
  }
});

test('exactly one seeded chain is intentionally tampered and all others verify', async () => {
  const data = buildSeedData(new Date('2026-10-24T12:00:00.000Z'));
  const results = data.traceabilityRecords.map((record) => verifyRecordChain(record));
  const invalid = results.filter((result) => !result.valid);
  assert.equal(invalid.length, 1);
  assert.equal(invalid[0].totalEvents > 0, true);
  assert.ok(invalid[0].brokenAt);
  assert.ok(data.traceabilityRecords.some((record) => record.integrityException === true));
  assert.equal(results.filter((result) => result.valid).length, data.traceabilityRecords.length - 1);
});

test('terminal orders carry no active risk', () => {
  const supplier = { riskLevel: 'HIGH', onTimeRate: 0.7 };
  for (const status of ['DELIVERED', 'CANCELLED']) {
    const risk = computeOrderRisk({ status, priority: 'CRITICAL', expectedDeliveryAt: '2020-01-01T00:00:00.000Z' }, {
      supplier,
      now: new Date('2026-10-24T12:00:00.000Z'),
    });
    assert.equal(risk.score, 0);
    assert.equal(risk.level, 'LOW');
  }
});

test('repository filters, sorts, paginates, and aggregates orders', async () => {
  const dir = await tempDir();
  try {
    const store = new JsonStore({ dataDir: dir, seed: true });
    await store.init();
    const repo = createRepository({ store });
    const firstPage = repo.listOrders({ filter: { status: ['SHIPPED'] }, sort: { field: 'TOTAL_VALUE', direction: 'DESC' }, first: 3 });
    assert.equal(firstPage.totalCount, 8);
    assert.equal(firstPage.nodes.length, 3);
    assert.ok(firstPage.pageInfo.hasNextPage);
    const values = firstPage.nodes.map((order) => order.totalValue);
    assert.deepEqual(values, [...values].sort((a, b) => b - a));

    const secondPage = repo.listOrders({ filter: { status: ['SHIPPED'] }, sort: { field: 'TOTAL_VALUE', direction: 'DESC' }, first: 3, after: firstPage.pageInfo.endCursor });
    assert.equal(secondPage.nodes.length, 3);
    assert.equal(secondPage.pageInfo.hasPreviousPage, true);
    assert.ok(secondPage.nodes.every((order) => !firstPage.nodes.some((first) => first.id === order.id)));

    const search = repo.listOrders({ filter: { search: 'Kavery' }, first: 10 });
    assert.equal(search.totalCount, 0);
    const atlas = repo.listOrders({ filter: { search: 'atlas' }, first: 10 });
    assert.ok(atlas.totalCount > 0);
    assert.ok(atlas.nodes.every((order) => order.supplierId === 'SUP-ATLAS'));

    const risk = repo.listOrders({ filter: { riskLevel: ['HIGH', 'CRITICAL'] }, first: 50 });
    assert.ok(risk.nodes.every((order) => {
      const level = repo.riskForOrder(order).level;
      return level === 'HIGH' || level === 'CRITICAL';
    }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('creating an order persists it for a new store instance', async () => {
  const dir = await tempDir();
  try {
    const store = new JsonStore({ dataDir: dir, seed: true });
    await store.init();
    const repo = createRepository({ store });
    const created = await repo.createOrder({
      supplierId: 'SUP-KAVERI',
      buyer: 'Persistence Test',
      priority: 'HIGH',
      incoterms: 'CIF',
      expectedDeliveryAt: new Date(Date.now() + 20 * 86_400_000).toISOString(),
      notes: 'Persist me',
      lines: [{ productId: 'PRD-1001', quantity: 25 }, { productId: 'PRD-1003', quantity: 10, unitPrice: 15 }],
    });
    assert.equal(created.status, 'DRAFT');
    assert.equal(created.lines.length, 2);
    await store.close();

    const reopened = new JsonStore({ dataDir: dir, seed: true });
    await reopened.init();
    const repo2 = createRepository({ store: reopened });
    const loaded = repo2.getOrder(created.id);
    assert.ok(loaded);
    assert.equal(loaded.buyer, 'Persistence Test');
    assert.equal(loaded.lines.length, 2);
    assert.equal(loaded.notes, 'Persist me');
    await reopened.close();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('appending a trace event extends and verifies the chain', async () => {
  const dir = await tempDir();
  try {
    const store = new JsonStore({ dataDir: dir, seed: true });
    await store.init();
    const repo = createRepository({ store });
    const record = repo.listTraceRecords({ first: 50 }).find((item) => verifyRecordChain(item).valid);
    assert.ok(record);
    const before = record.events.length;
    const updated = await repo.appendTraceEvent({
      recordId: record.id,
      type: 'QUALITY_CHECK',
      facilityId: 'FAC-ROTTERDAM',
      actor: 'Data test',
      notes: 'Extra inspection',
      occurredAt: new Date().toISOString(),
    });
    assert.equal(updated.events.length, before + 1);
    assert.equal(verifyRecordChain(updated).valid, true);
    assert.equal(verifyRecordChain(updated).checkedEvents, before + 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('metrics reconcile with the underlying order set', async () => {
  const dir = await tempDir();
  try {
    const store = new JsonStore({ dataDir: dir, seed: true });
    await store.init();
    const repo = createRepository({ store });
    const metrics = repo.metrics({ months: 6 });
    assert.equal(metrics.totalOrders, 52);
    assert.equal(metrics.byStatus.reduce((sum, item) => sum + item.count, 0), 52);
    assert.equal(metrics.riskDistribution.reduce((sum, item) => sum + item.count, 0), 49); // cancelled excluded
    assert.ok(metrics.chainIntegrity.totalRecords >= 30);
    assert.equal(metrics.chainIntegrity.valid + metrics.chainIntegrity.invalid, metrics.chainIntegrity.totalRecords);
    assert.equal(metrics.chainIntegrity.invalid, 1);
    assert.ok(metrics.traceabilityCoveragePct > 0 && metrics.traceabilityCoveragePct <= 100);
    assert.equal(metrics.spendTrend.length, 6);
    assert.ok(metrics.onTimeDeliveryRate >= 0 && metrics.onTimeDeliveryRate <= 100);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('rejects invalid order creation and illegal transitions', async () => {
  const dir = await tempDir();
  try {
    const store = new JsonStore({ dataDir: dir, seed: true });
    await store.init();
    const repo = createRepository({ store });
    await assert.rejects(
      () => repo.createOrder({
        supplierId: 'SUP-KAVERI',
        buyer: 'Bad',
        expectedDeliveryAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        lines: [{ productId: 'PRD-1005', quantity: 1 }],
      }),
      /not supplied by/,
    );
    await assert.rejects(
      () => repo.createOrder({
        supplierId: 'SUP-KAVERI',
        buyer: 'Bad',
        expectedDeliveryAt: new Date(Date.now() + 10 * 86_400_000).toISOString(),
        lines: [{ productId: 'PRD-1001', quantity: 0 }],
      }),
      /quantity/,
    );
    const draft = store.state.orders.find((order) => order.status === 'DRAFT');
    await assert.rejects(
      () => repo.updateOrderStatus({ orderId: draft.id, status: 'DELIVERED' }),
      /Cannot move order/,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
