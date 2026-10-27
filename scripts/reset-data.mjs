import { JsonStore } from '../src/data/store.js';
import { config, describeConfig } from '../src/config.js';
import { createLogger } from '../src/observability/logger.js';

if (!process.argv.includes('--yes')) {
  console.error(`Refusing to reset ${config.dataDir} without --yes.`);
  console.error('Stop the application first: the running process keeps its state in memory.');
  console.error('Usage: node scripts/reset-data.mjs --yes');
  process.exit(1);
}

const logger = createLogger({ level: config.logLevel });
const store = new JsonStore({ dataDir: config.dataDir, seed: true, logger });
await store.init();
const state = await store.reset();
await store.close();
console.log(`Reset ${describeConfig().dataDir} with ${state.orders.length} orders, ${state.suppliers.length} suppliers, and ${state.traceabilityRecords.length} traceability records.`);
