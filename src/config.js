import { readFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(readFileSync(path.join(rootDir, 'package.json'), 'utf8'));

const readInt = (name, fallback, { min = -Infinity, max = Infinity } = {}) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer, received "${raw}".`);
  return Math.max(min, Math.min(max, parsed));
};

const readBool = (name, fallback = false) => {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
};

const readList = (name) => (process.env[name] ?? '')
  .split(',')
  .map((entry) => entry.trim())
  .filter(Boolean);

export const config = {
  rootDir,
  publicDir: path.join(rootDir, 'public'),
  version: pkg.version,
  env: process.env.NODE_ENV ?? 'development',
  isProduction: (process.env.NODE_ENV ?? 'development') === 'production',
  host: process.env.HOST ?? '0.0.0.0',
  port: readInt('PORT', 8080, { min: 0, max: 65_535 }),
  dataDir: path.resolve(rootDir, process.env.DATA_DIR ?? 'data'),
  seedOnStart: readBool('SEED_ON_START', true),
  logLevel: (process.env.LOG_LEVEL ?? 'info').toLowerCase(),
  apiToken: process.env.API_TOKEN?.trim() ? process.env.API_TOKEN.trim() : null,
  allowedOrigins: readList('ALLOWED_ORIGINS'),
  readOnly: readBool('READ_ONLY', false),
  rateLimitMax: readInt('RATE_LIMIT_MAX', 120, { min: 0, max: 100_000 }),
  rateLimitWindowMs: readInt('RATE_LIMIT_WINDOW_MS', 60_000, { min: 1_000, max: 86_400_000 }),
  bodyLimitBytes: readInt('BODY_LIMIT_BYTES', 262_144, { min: 1_024, max: 10_485_760 }),
  trustProxy: readBool('TRUST_PROXY', false),
  enableHsts: readBool('ENABLE_HSTS', false),
  maxQueryDepth: readInt('MAX_QUERY_DEPTH', 12, { min: 3, max: 40 }),
  maxQueryFields: readInt('MAX_QUERY_FIELDS', 500, { min: 20, max: 10_000 }),
  startedAt: new Date().toISOString(),
};

export function describeConfig() {
  return {
    env: config.env,
    version: config.version,
    host: config.host,
    port: config.port,
    dataDir: config.dataDir,
    readOnly: config.readOnly,
    authEnabled: Boolean(config.apiToken),
    allowedOrigins: config.allowedOrigins,
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
    seedOnStart: config.seedOnStart,
  };
}
