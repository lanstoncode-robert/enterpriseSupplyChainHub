import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';

const CSP = [
  "default-src 'self'",
  "base-uri 'none'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "manifest-src 'self'",
].join('; ');

export function setSecurityHeaders(res, config) {
  res.setHeader('Content-Security-Policy', CSP);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Origin-Agent-Cluster', '?1');
  res.removeHeader('X-Powered-By');
  if (config.enableHsts) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
}

function acceptsGzip(req) {
  return /\bgzip\b/i.test(req.headers['accept-encoding'] ?? '');
}

function isCompressible(contentType) {
  return /^(text\/|application\/(json|graphql|javascript)|image\/svg\+xml)/i.test(contentType);
}

function appendVary(res, value) {
  const current = res.getHeader('Vary');
  if (!current) {
    res.setHeader('Vary', value);
    return;
  }
  const values = String(current).split(',').map((entry) => entry.trim().toLowerCase());
  if (!values.includes(value.toLowerCase())) res.setHeader('Vary', `${current}, ${value}`);
}

/**
 * Single response path for JSON, static assets, and schema documents.
 * Adds ETag-based revalidation, optional gzip, HEAD support, and never writes
 * a body for 204/304 responses.
 */
export function send(req, res, status, body, options = {}) {
  if (res.writableEnded) return;
  const {
    contentType = 'application/json; charset=utf-8',
    headers = {},
    cacheControl = 'no-store',
    compress = true,
    etag = true,
  } = options;

  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body), 'utf8');
  const hash = createHash('sha256').update(buffer).digest('base64url').slice(0, 22);
  // Weak validator: the same resource can be served gzip-encoded or identity.
  const etagValue = `W/"${hash}"`;

  for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', cacheControl);
  appendVary(res, 'Accept-Encoding');
  if (etag) res.setHeader('ETag', etagValue);

  if (status !== 204 && status !== 304 && etag && req.headers['if-none-match'] === etagValue) {
    res.statusCode = 304;
    res.removeHeader('Content-Type');
    res.removeHeader('Content-Length');
    res.end();
    return;
  }

  let payload = buffer;
  if (compress && buffer.length > 1024 && isCompressible(contentType) && acceptsGzip(req)) {
    payload = gzipSync(buffer, { level: 6 });
    res.setHeader('Content-Encoding', 'gzip');
  }

  res.statusCode = status;
  res.setHeader('Content-Length', payload.length);
  if (req.method === 'HEAD' || status === 204 || status === 304) {
    res.end();
    return;
  }
  res.end(payload);
}

export function sendJson(req, res, status, value, options = {}) {
  send(req, res, status, JSON.stringify(value), {
    contentType: 'application/json; charset=utf-8',
    ...options,
  });
}

export function sendText(req, res, status, value, options = {}) {
  send(req, res, status, value, {
    contentType: 'text/plain; charset=utf-8',
    ...options,
  });
}

export function sendHtml(req, res, status, value, options = {}) {
  send(req, res, status, value, {
    contentType: 'text/html; charset=utf-8',
    ...options,
  });
}
