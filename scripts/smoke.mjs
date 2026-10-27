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

const logger = createLogger({ level: 'silent' });
const dataDir = await mkdtemp(path.join(baseConfig.rootDir, '.tmp-smoke-'));
const config = {
  ...baseConfig,
  dataDir,
  host: '127.0.0.1',
  port: 0,
  logLevel: 'silent',
  apiToken: null,
  rateLimitMax: 500,
};
const store = new JsonStore({ dataDir, seed: true, logger });
const server = createServer();
let close;

try {
  await store.init();
  const repo = createRepository({ store, logger });
  const app = createApp({ config, logger, store, repo, schema });
  server.on('request', app.handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}`;

  const health = await fetch(`${base}/healthz`);
  assert.equal(health.status, 200, 'health endpoint');

  const ready = await fetch(`${base}/readyz`);
  assert.equal(ready.status, 200, 'readiness endpoint');

  const page = await fetch(`${base}/`);
  assert.equal(page.status, 200, 'dashboard shell');
  assert.match(await page.text(), /Skip to main content/, 'skip link');

  const styles = await fetch(`${base}/assets/app.css`);
  assert.equal(styles.status, 200, 'compiled stylesheet');
  assert.ok((await styles.text()).length > 10_000, 'stylesheet should not be empty');

  const graphql = await fetch(`${base}/graphql`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: '{ metrics { totalOrders chainIntegrity { totalRecords } } gatewayInfo { subgraphs { name } } }' }),
  });
  assert.equal(graphql.status, 200, 'GraphQL endpoint');
  const payload = await graphql.json();
  assert.equal(payload.errors, undefined, JSON.stringify(payload.errors));
  assert.equal(payload.data.metrics.totalOrders, 52);
  assert.ok(payload.data.metrics.chainIntegrity.totalRecords >= 30);
  assert.equal(payload.data.gatewayInfo.subgraphs.length, 3);

  console.log('smoke: health, readiness, static shell, CSS, and stitched GraphQL all passed');
  console.log(`smoke: ${payload.data.metrics.totalOrders} orders, ${payload.data.metrics.chainIntegrity.totalRecords} traceability records`);
} finally {
  close = await new Promise((resolve) => {
    server.close(resolve);
    server.closeAllConnections?.();
  });
  await store.close();
  await rm(dataDir, { recursive: true, force: true });
}
