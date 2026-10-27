import { randomUUID, timingSafeEqual } from 'node:crypto';
import { parse } from '../graphql/parser.js';
import { validate } from '../graphql/validate.js';
import { execute, getOperation } from '../graphql/execute.js';
import { formatError } from '../graphql/errors.js';
import { printSchema, schemaToJSON } from '../graphql/schema.js';
import { send, sendJson, sendText, setSecurityHeaders } from './respond.js';
import { createStaticHandler } from './static.js';

const MAX_QUERY_CHARS = 60_000;

class HttpError extends Error {
  constructor(status, message, code = 'HTTP_ERROR', headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

class FixedWindowRateLimiter {
  constructor(max, windowMs) {
    this.max = max;
    this.windowMs = windowMs;
    this.buckets = new Map();
  }

  check(key, now = Date.now()) {
    if (this.max <= 0) return { allowed: true, remaining: Infinity, resetAt: now + this.windowMs };
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (this.buckets.size > 10_000) this.prune(now);
    return {
      allowed: bucket.count <= this.max,
      remaining: Math.max(0, this.max - bucket.count),
      resetAt: bucket.resetAt,
    };
  }

  prune(now) {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetAt <= now) this.buckets.delete(key);
    }
  }
}

function createMetricsRegistry() {
  const http = new Map();
  const graph = new Map();
  const errors = new Map();
  const bump = (map, key) => map.set(key, (map.get(key) ?? 0) + 1);
  return {
    http(route, method, status) {
      bump(http, `${route}\u0000${method}\u0000${status}`);
    },
    graphql(operation, name, status) {
      bump(graph, `${operation}\u0000${name}\u0000${status}`);
    },
    error(code) {
      bump(errors, code);
    },
    render({ repo, startedAt, limiter, version }) {
      const lines = [];
      lines.push('# HELP sch_build_info Build metadata for the supply chain hub.');
      lines.push('# TYPE sch_build_info gauge');
      lines.push(`sch_build_info{version="${escapeLabel(version)}",node="${escapeLabel(process.version)}"} 1`);
      lines.push('# HELP sch_process_uptime_seconds Process uptime in seconds.');
      lines.push('# TYPE sch_process_uptime_seconds gauge');
      lines.push(`sch_process_uptime_seconds ${Math.max(0, (Date.now() - startedAt) / 1000).toFixed(3)}`);
      lines.push('# HELP sch_process_resident_memory_bytes Resident memory size in bytes.');
      lines.push('# TYPE sch_process_resident_memory_bytes gauge');
      lines.push(`sch_process_resident_memory_bytes ${process.memoryUsage().rss}`);

      lines.push('# HELP sch_http_requests_total HTTP requests by route, method, and status.');
      lines.push('# TYPE sch_http_requests_total counter');
      for (const [key, value] of http) {
        const [route, method, status] = key.split('\u0000');
        lines.push(`sch_http_requests_total{route="${escapeLabel(route)}",method="${escapeLabel(method)}",status="${escapeLabel(status)}"} ${value}`);
      }

      lines.push('# HELP sch_graphql_operations_total GraphQL operations by type, name, and outcome.');
      lines.push('# TYPE sch_graphql_operations_total counter');
      for (const [key, value] of graph) {
        const [operation, name, status] = key.split('\u0000');
        lines.push(`sch_graphql_operations_total{operation="${escapeLabel(operation)}",name="${escapeLabel(name)}",status="${escapeLabel(status)}"} ${value}`);
      }

      lines.push('# HELP sch_graphql_errors_total GraphQL errors by extension code.');
      lines.push('# TYPE sch_graphql_errors_total counter');
      for (const [code, value] of errors) {
        lines.push(`sch_graphql_errors_total{code="${escapeLabel(code)}"} ${value}`);
      }

      const counts = repo.counts();
      lines.push('# HELP sch_data_records Current number of records held by the hub.');
      lines.push('# TYPE sch_data_records gauge');
      for (const [name, value] of Object.entries(counts)) {
        lines.push(`sch_data_records{entity="${escapeLabel(name)}"} ${value}`);
      }
      lines.push('# HELP sch_rate_limit_buckets Number of active rate-limit buckets.');
      lines.push('# TYPE sch_rate_limit_buckets gauge');
      lines.push(`sch_rate_limit_buckets ${limiter.buckets.size}`);
      return `${lines.join('\n')}\n`;
    },
  };
}

function escapeLabel(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"').slice(0, 120);
}

function clientIp(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function requestHost(req, trustProxy) {
  if (trustProxy) {
    const forwarded = req.headers['x-forwarded-host'];
    if (typeof forwarded === 'string' && forwarded.length > 0) return forwarded.split(',')[0].trim();
  }
  return (req.headers.host ?? 'localhost').trim();
}

function originAllowed(origin, host, allowedOrigins) {
  if (allowedOrigins.includes('*')) return true;
  try {
    if (new URL(origin).host === host) return true;
  } catch {
    return false;
  }
  return allowedOrigins.includes(origin);
}

function applyCors(req, res, config, host) {
  const origin = req.headers.origin;
  if (!origin) return true;
  if (!originAllowed(origin, host, config.allowedOrigins)) {
    sendJson(req, res, 403, { error: { message: 'Origin is not allowed.', code: 'CORS_FORBIDDEN' } });
    return false;
  }
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Request-Id, If-None-Match');
  res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Request-Id, RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset, Retry-After');
  res.setHeader('Access-Control-Max-Age', '600');
  const currentVary = res.getHeader('Vary');
  res.setHeader('Vary', currentVary ? `${currentVary}, Origin` : 'Origin');
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return false;
  }
  return true;
}

function authorized(req, token) {
  if (!token) return true;
  const header = req.headers.authorization;
  if (typeof header !== 'string') return false;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const declared = Number(req.headers['content-length']);
    if (Number.isFinite(declared) && declared > limit) {
      reject(new HttpError(413, `Request body exceeds ${limit} bytes.`, 'PAYLOAD_TOO_LARGE'));
      req.resume();
      return;
    }
    let total = 0;
    let failed = false;
    const chunks = [];
    req.on('data', (chunk) => {
      if (failed) return;
      total += chunk.length;
      if (total > limit) {
        failed = true;
        reject(new HttpError(413, `Request body exceeds ${limit} bytes.`, 'PAYLOAD_TOO_LARGE'));
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!failed) resolve(Buffer.concat(chunks));
    });
    req.on('error', (error) => {
      if (!failed) reject(new HttpError(400, `Could not read request body: ${error.message}`, 'BAD_REQUEST'));
    });
  });
}

function analyzeDocument(document, fieldLimit) {
  const fragments = new Map();
  for (const definition of document.definitions) {
    if (definition.kind === 'FragmentDefinition') fragments.set(definition.name, definition);
  }
  let fields = 0;
  let depth = 0;
  let exceeded = false;

  const walk = (selectionSet, level, stack) => {
    if (exceeded) return;
    for (const selection of selectionSet.selections) {
      if (fields > fieldLimit) {
        exceeded = true;
        return;
      }
      if (selection.kind === 'Field') {
        fields += 1;
        depth = Math.max(depth, level);
        if (selection.selectionSet) walk(selection.selectionSet, level + 1, stack);
      } else if (selection.kind === 'InlineFragment') {
        walk(selection.selectionSet, level, stack);
      } else if (selection.kind === 'FragmentSpread') {
        if (stack.has(selection.name)) continue;
        const fragment = fragments.get(selection.name);
        if (fragment) walk(fragment.selectionSet, level, new Set(stack).add(selection.name));
      }
    }
  };

  for (const definition of document.definitions) {
    if (definition.kind === 'OperationDefinition') walk(definition.selectionSet, 1, new Set());
  }
  return { fields, depth, exceeded: exceeded || fields > fieldLimit };
}

export function createApp({ config, logger, store, repo, schema }) {
  const staticHandler = createStaticHandler(config.publicDir);
  const limiter = new FixedWindowRateLimiter(config.rateLimitMax, config.rateLimitWindowMs);
  const metrics = createMetricsRegistry();
  const startedAt = Date.parse(config.startedAt) || Date.now();
  const schemaSDL = printSchema(schema);
  const schemaJSON = JSON.stringify(schemaToJSON(schema), null, 2);

  async function handleGraphQL(req, res, { requestId, ip }) {
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST, OPTIONS');
      sendJson(req, res, 405, { error: { message: 'GraphQL only accepts POST requests.', code: 'METHOD_NOT_ALLOWED' } });
      return;
    }

    const rate = limiter.check(ip);
    if (config.rateLimitMax > 0) {
      res.setHeader('RateLimit-Limit', String(config.rateLimitMax));
      res.setHeader('RateLimit-Remaining', String(rate.remaining));
      res.setHeader('RateLimit-Reset', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
    }
    if (!rate.allowed) {
      res.setHeader('Retry-After', String(Math.max(1, Math.ceil((rate.resetAt - Date.now()) / 1000))));
      sendJson(req, res, 429, { errors: [{ message: 'Too many requests. Retry later.', extensions: { code: 'RATE_LIMITED' } }] });
      return;
    }

    if (!authorized(req, config.apiToken)) {
      res.setHeader('WWW-Authenticate', 'Bearer realm="supply-chain-hub"');
      sendJson(req, res, 401, { errors: [{ message: 'A valid bearer token is required.', extensions: { code: 'UNAUTHORIZED' } }] });
      return;
    }

    const contentType = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase();
    if (contentType !== 'application/json') {
      sendJson(req, res, 415, { errors: [{ message: 'Content-Type must be application/json.', extensions: { code: 'UNSUPPORTED_MEDIA_TYPE' } }] });
      return;
    }

    let payload;
    try {
      const raw = await readBody(req, config.bodyLimitBytes);
      payload = JSON.parse(raw.toString('utf8'));
    } catch (error) {
      if (error instanceof HttpError) throw error;
      sendJson(req, res, 400, { errors: [{ message: 'Request body must be valid JSON.', extensions: { code: 'BAD_REQUEST' } }] });
      return;
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      sendJson(req, res, 400, { errors: [{ message: 'GraphQL request body must be a JSON object.', extensions: { code: 'BAD_REQUEST' } }] });
      return;
    }
    if (typeof payload.query !== 'string' || payload.query.trim().length === 0) {
      sendJson(req, res, 400, { errors: [{ message: '"query" must be a non-empty string.', extensions: { code: 'BAD_REQUEST' } }] });
      return;
    }
    if (payload.query.length > MAX_QUERY_CHARS) {
      sendJson(req, res, 400, { errors: [{ message: `Query exceeds ${MAX_QUERY_CHARS} characters.`, extensions: { code: 'QUERY_TOO_LARGE' } }] });
      return;
    }
    if (payload.variables !== undefined && payload.variables !== null && (typeof payload.variables !== 'object' || Array.isArray(payload.variables))) {
      sendJson(req, res, 400, { errors: [{ message: '"variables" must be a JSON object.', extensions: { code: 'BAD_REQUEST' } }] });
      return;
    }
    if (payload.operationName !== undefined && payload.operationName !== null && typeof payload.operationName !== 'string') {
      sendJson(req, res, 400, { errors: [{ message: '"operationName" must be a string or null.', extensions: { code: 'BAD_REQUEST' } }] });
      return;
    }

    const requestStarted = process.hrtime.bigint();
    let document;
    try {
      document = parse(payload.query);
    } catch (error) {
      metrics.error(error.extensions?.code ?? 'GRAPHQL_PARSE_FAILED');
      sendJson(req, res, 200, { errors: [error.toJSON ? error.toJSON() : { message: error.message }] });
      return;
    }

    const complexity = analyzeDocument(document, config.maxQueryFields);
    if (complexity.exceeded || complexity.depth > config.maxQueryDepth) {
      metrics.error('QUERY_TOO_COMPLEX');
      sendJson(req, res, 200, {
        errors: [{
          message: `Query is too complex. Limits: depth ${config.maxQueryDepth}, fields ${config.maxQueryFields}.`,
          extensions: { code: 'QUERY_TOO_COMPLEX', depth: complexity.depth, fields: complexity.fields },
        }],
      });
      return;
    }

    const validationErrors = validate(schema, document);
    if (validationErrors.length > 0) {
      for (const error of validationErrors) metrics.error(error.extensions?.code ?? 'GRAPHQL_VALIDATION_FAILED');
      sendJson(req, res, 200, { errors: validationErrors.map(formatError) });
      return;
    }

    const operation = getOperation(document, payload.operationName ?? null);
    if (!operation) {
      sendJson(req, res, 200, {
        errors: [{
          message: payload.operationName ? `Unknown operation named "${payload.operationName}".` : 'Must provide an operation.',
          extensions: { code: 'GRAPHQL_VALIDATION_FAILED' },
        }],
      });
      return;
    }

    if (config.readOnly && operation.operation === 'mutation') {
      metrics.error('READ_ONLY');
      sendJson(req, res, 200, {
        errors: [{
          message: 'This deployment is read-only. Mutations are disabled.',
          extensions: { code: 'READ_ONLY' },
        }],
      });
      return;
    }

    const contextValue = {
      repo,
      loaders: repo.createLoaders(),
      config,
      logger: logger.child({ requestId }),
      requestId,
      ip,
    };

    let result;
    try {
      result = await execute({
        schema,
        document,
        operationName: payload.operationName ?? null,
        variableValues: payload.variables ?? {},
        contextValue,
        maskInternalErrors: config.isProduction,
      });
    } catch (error) {
      metrics.error('INTERNAL_SERVER_ERROR');
      logger.error('graphql.execute_failed', { requestId, message: error.message, stack: error.stack });
      sendJson(req, res, 200, { errors: [{ message: 'Internal server error', extensions: { code: 'INTERNAL_SERVER_ERROR' } }] });
      return;
    }

    const durationMs = Number(process.hrtime.bigint() - requestStarted) / 1e6;
    const failed = Boolean(result.errors?.length);
    metrics.graphql(operation.operation, operation.name ?? 'anonymous', failed ? 'error' : 'success');
    for (const error of result.errors ?? []) metrics.error(error.extensions?.code ?? 'GRAPHQL_ERROR');
    logger.info('graphql.request', {
      requestId,
      operation: operation.operation,
      operationName: operation.name ?? null,
      durationMs: Math.round(durationMs * 100) / 100,
      errors: result.errors?.length ?? 0,
      ip,
    });

    sendJson(req, res, 200, {
      ...result,
      extensions: { requestId, durationMs: Math.round(durationMs * 100) / 100 },
    }, { cacheControl: 'no-store' });
  }

  async function handler(req, res) {
    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    setSecurityHeaders(res, config);
    const started = process.hrtime.bigint();
    let route = 'other';
    const trustProxy = config.trustProxy;

    res.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1e6;
      metrics.http(route, req.method ?? 'UNKNOWN', res.statusCode);
      logger.info('http.request', {
        requestId,
        method: req.method,
        path: (req.url ?? '').split('?')[0],
        status: res.statusCode,
        durationMs: Math.round(durationMs * 100) / 100,
        ip: clientIp(req, trustProxy),
      });
    });

    try {
      const host = requestHost(req, trustProxy);
      let url;
      try {
        url = new URL(req.url ?? '/', `http://${host}`);
      } catch {
        throw new HttpError(400, 'Malformed request URL.', 'BAD_REQUEST');
      }

      if (!applyCors(req, res, config, host)) return;

      const pathname = url.pathname;
      const ip = clientIp(req, trustProxy);

      if (pathname === '/healthz') {
        route = 'healthz';
        sendJson(req, res, 200, {
          status: 'ok',
          version: config.version,
          uptimeSeconds: Math.max(0, Math.round((Date.now() - startedAt) / 1000)),
          timestamp: new Date().toISOString(),
        });
        return;
      }

      if (pathname === '/readyz') {
        route = 'readyz';
        const health = await store.health();
        const ready = Boolean(health.ok && store.state);
        sendJson(req, res, ready ? 200 : 503, {
          status: ready ? 'ready' : 'not_ready',
          checks: {
            datastore: {
              ok: health.ok,
              counts: health.counts,
              lastPersistedAt: health.lastPersistedAt,
            },
          },
          version: config.version,
        });
        return;
      }

      if (pathname === '/metrics') {
        route = 'metrics';
        const body = metrics.render({ repo, startedAt, limiter, version: config.version });
        sendText(req, res, 200, body, { cacheControl: 'no-store', contentType: 'text/plain; version=0.0.4; charset=utf-8' });
        return;
      }

      if (pathname === '/graphql/schema.graphql' || pathname === '/schema.graphql') {
        route = 'schema';
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('Allow', 'GET, HEAD, OPTIONS');
          sendJson(req, res, 405, { error: { message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' } });
          return;
        }
        sendText(req, res, 200, schemaSDL, { contentType: 'application/graphql; charset=utf-8', cacheControl: 'public, max-age=60' });
        return;
      }

      if (pathname === '/graphql/schema.json' || pathname === '/graphql/schema' || pathname === '/schema.json') {
        route = 'schema';
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          res.setHeader('Allow', 'GET, HEAD, OPTIONS');
          sendJson(req, res, 405, { error: { message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' } });
          return;
        }
        sendText(req, res, 200, schemaJSON, { contentType: 'application/json; charset=utf-8', cacheControl: 'public, max-age=60' });
        return;
      }

      if (pathname === '/graphql' || pathname === '/graphql/') {
        route = 'graphql';
        await handleGraphQL(req, res, { requestId, ip });
        return;
      }

      route = 'static';
      await staticHandler(req, res, pathname);
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_SERVER_ERROR';
      if (status >= 500) {
        logger.error('http.unhandled_error', { requestId, message: error.message, stack: error.stack });
      }
      if (!res.headersSent) {
        if (route === 'graphql') {
          sendJson(req, res, status, { errors: [{ message: status >= 500 ? 'Internal server error' : error.message, extensions: { code } }] });
        } else {
          sendJson(req, res, status, { error: { message: status >= 500 ? 'Internal server error' : error.message, code, requestId } });
        }
      } else if (!res.writableEnded) {
        res.end();
      }
    }
  }

  return { handler, limiter, metrics, schemaSDL };
}
