import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import { config as baseConfig } from '../src/config.js';
import { JsonStore } from '../src/data/store.js';
import { createRepository } from '../src/data/repository.js';
import { createApp } from '../src/http/app.js';
import { schema } from '../src/gateway/index.js';
import { createLogger } from '../src/observability/logger.js';

async function withServer(overrides, fn) {
  const dataDir = await mkdtemp(path.join(baseConfig.rootDir, '.tmp-test-'));
  const config = {
    ...baseConfig,
    dataDir,
    host: '127.0.0.1',
    port: 0,
    logLevel: 'silent',
    apiToken: null,
    allowedOrigins: [],
    rateLimitMax: 500,
    readOnly: false,
    ...overrides,
  };
  const logger = createLogger({ level: 'silent' });
  const store = new JsonStore({ dataDir, logger, seed: true });
  await store.init();
  const repo = createRepository({ store, logger });
  const app = createApp({ config, logger, store, repo, schema });
  const server = createServer(app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;
  try {
    await fn({ base, port, config, store, repo, app });
  } finally {
    await new Promise((resolve) => {
      server.close(resolve);
      server.closeAllConnections?.();
    });
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  }
}

async function graphql(base, query, variables = {}, extraHeaders = {}) {
  const response = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  return { response, payload };
}

test('serves the dashboard shell, compiled CSS, and security headers', async () => {
  await withServer({}, async ({ base }) => {
    const page = await fetch(`${base}/`);
    assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /<html lang="en"/);
    assert.match(html, /Skip to main content/);
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');

    const css = await fetch(`${base}/assets/app.css`);
    assert.equal(css.status, 200);
    assert.match(css.headers.get('content-type'), /text\/css/);
    const cssBody = await css.text();
    assert.ok(cssBody.includes('.data-table'));
    assert.ok(cssBody.includes('skip-link'));

    const etag = css.headers.get('etag');
    assert.ok(etag?.startsWith('W/'));
    const revalidated = await fetch(`${base}/assets/app.css`, { headers: { 'If-None-Match': etag } });
    assert.equal(revalidated.status, 304);

    const manifest = await fetch(`${base}/js/microfrontends/manifest.json`);
    assert.equal(manifest.status, 200);
    assert.ok((await manifest.json()).microfrontends.length >= 4);
  });
});

test('health, readiness, metrics, and schema endpoints respond', async () => {
  await withServer({}, async ({ base }) => {
    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).status, 'ok');

    const ready = await fetch(`${base}/readyz`);
    assert.equal(ready.status, 200);
    assert.equal((await ready.json()).status, 'ready');

    const metrics = await fetch(`${base}/metrics`);
    const text = await metrics.text();
    assert.match(text, /sch_build_info/);
    assert.match(text, /sch_data_records\{entity="orders"\} 52/);

    const sdl = await fetch(`${base}/graphql/schema.graphql`);
    assert.equal(sdl.status, 200);
    assert.match(await sdl.text(), /type PurchaseOrder/);

    const json = await fetch(`${base}/graphql/schema.json`);
    const schemaJson = await json.json();
    assert.equal(schemaJson.queryType, 'Query');
    assert.ok(schemaJson.stitch.subgraphs.some((subgraph) => subgraph.name === 'traceability'));
  });
});

test('executes stitched queries across orders, traceability, and gateway metadata', async () => {
  await withServer({}, async ({ base }) => {
    const { response, payload } = await graphql(base, /* GraphQL */ `
      query Dashboard {
        metrics { totalOrders openOrders onTimeDeliveryRate chainIntegrity { valid invalid totalRecords } }
        orders(first: 3, sort: { field: RISK, direction: DESC }) {
          totalCount
          aggregates { totalValue atRiskCount }
          nodes {
            poNumber
            status
            supplier { name }
            riskScore
            lines { quantity product { name } }
            traceability { lotCode chainVerified verification { valid } }
          }
        }
        gatewayInfo { subgraphs { name } dataCounts { orders traceabilityRecords } }
      }
    `);
    assert.equal(response.status, 200);
    assert.equal(payload.errors, undefined);
    assert.equal(payload.data.metrics.totalOrders, 52);
    assert.equal(payload.data.orders.totalCount, 52);
    assert.ok(payload.data.orders.nodes[0].supplier.name);
    assert.ok(payload.data.gatewayInfo.subgraphs.some((subgraph) => subgraph.name === 'orders'));
    assert.equal(payload.data.gatewayInfo.dataCounts.orders, 52);
    assert.ok(payload.data.metrics.chainIntegrity.totalRecords > 0);
  });
});

test('creates a draft order, enforces transitions, and persists status changes', async () => {
  await withServer({}, async ({ base }) => {
    const expectedDeliveryAt = new Date(Date.now() + 30 * 86_400_000).toISOString();
    const created = await graphql(base, /* GraphQL */ `
      mutation Create($input: CreatePurchaseOrderInput!) {
        createPurchaseOrder(input: $input) {
          id poNumber status totalValue
          lines { product { id name } quantity unitPrice }
          allowedTransitions
        }
      }
    `, {
      input: {
        supplierId: 'SUP-KAVERI',
        buyer: 'Integration Test EU',
        expectedDeliveryAt,
        lines: [{ productId: 'PRD-1001', quantity: 50 }],
      },
    });
    assert.equal(created.payload.errors, undefined);
    const order = created.payload.data.createPurchaseOrder;
    assert.equal(order.status, 'DRAFT');
    assert.equal(order.lines[0].quantity, 50);
    assert.ok(order.totalValue > 0);

    const invalid = await graphql(base, /* GraphQL */ `
      mutation Bad($input: UpdateOrderStatusInput!) { updateOrderStatus(input: $input) { id } }
    `, { input: { orderId: order.id, status: 'SHIPPED' } });
    assert.equal(invalid.payload.errors[0].extensions.code, 'BAD_USER_INPUT');
    assert.match(invalid.payload.errors[0].message, /Cannot move order/);

    const updated = await graphql(base, /* GraphQL */ `
      mutation Good($input: UpdateOrderStatusInput!) { updateOrderStatus(input: $input) { id status allowedTransitions } }
    `, { input: { orderId: order.id, status: 'PENDING_CONFIRMATION', note: 'Sent to supplier' } });
    assert.equal(updated.payload.errors, undefined);
    assert.equal(updated.payload.data.updateOrderStatus.status, 'PENDING_CONFIRMATION');
    assert.ok(updated.payload.data.updateOrderStatus.allowedTransitions.includes('CONFIRMED'));

    const reloaded = await graphql(base, `query($id: ID) { order(id: $id) { status statusHistory { status note } } }`, { id: order.id });
    assert.equal(reloaded.payload.data.order.status, 'PENDING_CONFIRMATION');
    assert.ok(reloaded.payload.data.order.statusHistory.some((entry) => entry.note === 'Sent to supplier'));
  });
});

test('appends traceability events and keeps the hash chain verified', async () => {
  await withServer({}, async ({ base }) => {
    const list = await graphql(base, /* GraphQL */ `
      query { traceabilityRecords(first: 50) { id lotCode chainVerified events { sequence } verification { valid } } }
    `);
    const record = list.payload.data.traceabilityRecords.find((item) => item.chainVerified);
    assert.ok(record, 'seed should contain at least one valid chain');

    const appended = await graphql(base, /* GraphQL */ `
      mutation Append($input: AppendTraceEventInput!) {
        appendTraceEvent(input: $input) {
          lotCode
          events { type sequence actor }
          chainVerified
          verification { valid checkedEvents totalEvents }
        }
      }
    `, {
      input: {
        recordId: record.id,
        type: 'QUALITY_CHECK',
        facilityId: 'FAC-ROTTERDAM',
        actor: 'Integration Test',
        notes: 'Additional lab inspection',
        occurredAt: new Date().toISOString(),
      },
    });
    assert.equal(appended.payload.errors, undefined);
    const result = appended.payload.data.appendTraceEvent;
    assert.equal(result.chainVerified, true);
    assert.equal(result.verification.valid, true);
    assert.equal(result.events.at(-1).actor, 'Integration Test');
    assert.ok(result.verification.checkedEvents >= 2);
  });
});

test('rejects unknown fields, malformed JSON, and unsupported methods', async () => {
  await withServer({}, async ({ base }) => {
    const unknown = await graphql(base, '{ definitelyNotAField }');
    assert.equal(unknown.response.status, 200);
    assert.match(unknown.payload.errors[0].message, /Cannot query field "definitelyNotAField"/);

    const malformed = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{ not json',
    });
    assert.equal(malformed.status, 400);

    const wrongType = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'query { __typename }',
    });
    assert.equal(wrongType.status, 415);

    const get = await fetch(`${base}/graphql`);
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  });
});

test('requires a bearer token when API_TOKEN is configured', async () => {
  await withServer({ apiToken: 'test-secret-token' }, async ({ base }) => {
    const noAuth = await graphql(base, '{ __typename }');
    assert.equal(noAuth.response.status, 401);
    assert.equal(noAuth.payload.errors[0].extensions.code, 'UNAUTHORIZED');

    const wrong = await graphql(base, '{ __typename }', {}, { Authorization: 'Bearer wrong' });
    assert.equal(wrong.response.status, 401);

    const good = await graphql(base, '{ gatewayInfo { version } }', {}, { Authorization: 'Bearer test-secret-token' });
    assert.equal(good.response.status, 200);
    assert.equal(good.payload.errors, undefined);
    assert.equal(good.payload.data.gatewayInfo.version, '1.0.0');

    const health = await fetch(`${base}/healthz`);
    assert.equal(health.status, 200);
  });
});

test('read-only mode rejects mutations at the gateway', async () => {
  await withServer({ readOnly: true }, async ({ base }) => {
    const expectedDeliveryAt = new Date(Date.now() + 10 * 86_400_000).toISOString();
    const result = await graphql(base, /* GraphQL */ `
      mutation Create($input: CreatePurchaseOrderInput!) { createPurchaseOrder(input: $input) { id } }
    `, {
      input: {
        supplierId: 'SUP-RHINE',
        buyer: 'Read only',
        expectedDeliveryAt,
        lines: [{ productId: 'PRD-1006', quantity: 10 }],
      },
    });
    assert.equal(result.payload.errors[0].extensions.code, 'READ_ONLY');
  });
});

test('rate limit returns 429 with retry metadata', async () => {
  await withServer({ rateLimitMax: 2, rateLimitWindowMs: 60_000 }, async ({ base }) => {
    const first = await graphql(base, '{ gatewayInfo { version } }');
    const second = await graphql(base, '{ gatewayInfo { version } }');
    const third = await graphql(base, '{ gatewayInfo { version } }');
    assert.equal(first.response.status, 200);
    assert.equal(second.response.status, 200);
    assert.equal(third.response.status, 429);
    assert.ok(third.response.headers.get('retry-after'));
    assert.equal(third.payload.errors[0].extensions.code, 'RATE_LIMITED');
  });
});

test('CORS allows configured origins and rejects everything else', async () => {
  await withServer({ allowedOrigins: ['https://ops.example'] }, async ({ base }) => {
    const preflight = await fetch(`${base}/graphql`, {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://ops.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    assert.equal(preflight.status, 204);
    assert.equal(preflight.headers.get('access-control-allow-origin'), 'https://ops.example');

    const forbidden = await fetch(`${base}/healthz`, { headers: { Origin: 'https://evil.example' } });
    assert.equal(forbidden.status, 403);
    assert.equal((await forbidden.json()).error.code, 'CORS_FORBIDDEN');
  });
});

test('blocks path traversal and serves a branded 404', async () => {
  await withServer({}, async ({ base }) => {
    const traversal = await fetch(`${base}/..%2F..%2Fpackage.json`);
    assert.ok([400, 403, 404].includes(traversal.status));

    const missing = await fetch(`${base}/not-a-real-page`);
    assert.equal(missing.status, 404);
    assert.match(await missing.text(), /Page not found/);
  });
});

test('rejects oversized bodies with 413', async () => {
  await withServer({ bodyLimitBytes: 1024 }, async ({ base }) => {
    const response = await fetch(`${base}/graphql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: '{ __typename }', padding: 'x'.repeat(4096) }),
    });
    assert.equal(response.status, 413);
  });
});
