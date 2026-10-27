import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { send } from './respond.js';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Static asset handler with path-traversal protection, ETag revalidation,
 * in-memory body caching keyed by mtime/size, and a branded 404.
 */
export function createStaticHandler(publicDir) {
  const root = path.resolve(publicDir);
  const cache = new Map();

  async function load(target) {
    const info = await stat(target);
    if (!info.isFile()) return null;
    const cached = cache.get(target);
    if (cached && cached.mtimeMs === info.mtimeMs && cached.size === info.size) return cached;
    const body = await readFile(target);
    const entry = { body, mtimeMs: info.mtimeMs, size: info.size };
    cache.set(target, entry);
    return entry;
  }

  function notFound(req, res) {
    return load(path.join(root, '404.html'))
      .then((entry) => {
        if (!entry) {
          send(req, res, 404, 'Not found', { contentType: 'text/plain; charset=utf-8' });
          return;
        }
        send(req, res, 404, entry.body, {
          contentType: 'text/html; charset=utf-8',
          cacheControl: 'no-cache',
          headers: { 'X-Robots-Tag': 'noindex' },
        });
      })
      .catch(() => {
        send(req, res, 404, 'Not found', { contentType: 'text/plain; charset=utf-8' });
      });
  }

  return async function serveStatic(req, res, pathname) {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD, OPTIONS');
      send(req, res, 405, JSON.stringify({ error: { message: 'Method not allowed.', code: 'METHOD_NOT_ALLOWED' } }), {
        contentType: 'application/json; charset=utf-8',
      });
      return;
    }

    let decoded;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      send(req, res, 400, 'Malformed URL.', { contentType: 'text/plain; charset=utf-8' });
      return;
    }
    if (decoded.includes('\0')) {
      send(req, res, 400, 'Malformed URL.', { contentType: 'text/plain; charset=utf-8' });
      return;
    }

    let relative = decoded.replace(/^\/+/, '');
    if (relative === '' || relative.endsWith('/')) relative = `${relative}index.html`;

    const target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      send(req, res, 403, 'Forbidden.', { contentType: 'text/plain; charset=utf-8' });
      return;
    }

    try {
      const entry = await load(target);
      if (!entry) {
        await notFound(req, res);
        return;
      }
      const extension = path.extname(target).toLowerCase();
      const isHtml = extension === '.html';
      const isAsset = relative.startsWith('assets/') || relative.startsWith('js/') || relative.startsWith('microfrontends/');
      send(req, res, 200, entry.body, {
        contentType: MIME[extension] ?? 'application/octet-stream',
        cacheControl: isHtml ? 'no-cache' : isAsset ? 'no-cache' : 'public, max-age=3600',
      });
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        await notFound(req, res);
        return;
      }
      throw error;
    }
  };
}
