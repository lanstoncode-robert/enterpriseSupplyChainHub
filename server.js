import { createServer } from 'node:http';
import { config, describeConfig } from './src/config.js';
import { createLogger } from './src/observability/logger.js';
import { JsonStore } from './src/data/store.js';
import { createRepository } from './src/data/repository.js';
import { schema } from './src/gateway/index.js';
import { createApp } from './src/http/app.js';

const logger = createLogger({ level: config.logLevel });

async function main() {
  logger.info('boot.start', describeConfig());

  const store = new JsonStore({
    dataDir: config.dataDir,
    logger,
    seed: config.seedOnStart,
    now: () => new Date(),
  });
  await store.init();

  const repo = createRepository({ store, logger });
  const app = createApp({ config, logger, store, repo, schema });

  const server = createServer(app.handler);
  server.keepAliveTimeout = 5_000;
  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;

  server.on('clientError', (error, socket) => {
    logger.warn('http.client_error', { message: error.message });
    if (!socket.writable) return;
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(config.port, config.host);
  });

  const address = server.address();
  const actualPort = typeof address === 'object' && address ? address.port : config.port;
  logger.info('boot.ready', {
    url: `http://${config.host === '0.0.0.0' ? '127.0.0.1' : config.host}:${actualPort}`,
    graphql: '/graphql',
    health: '/healthz',
    metrics: '/metrics',
    authEnabled: Boolean(config.apiToken),
    readOnly: config.readOnly,
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('shutdown.start', { signal });
    const force = setTimeout(() => {
      logger.error('shutdown.forced', { signal });
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async (error) => {
      if (error) logger.warn('shutdown.server_close_error', { message: error.message });
      try {
        await store.close();
        logger.info('shutdown.complete', { signal });
        clearTimeout(force);
        process.exit(0);
      } catch (closeError) {
        logger.error('shutdown.store_close_error', { message: closeError.message });
        process.exit(1);
      }
    });
    server.closeIdleConnections?.();
    setTimeout(() => server.closeAllConnections?.(), 8_000).unref();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error('process.unhandled_rejection', {
      message: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    });
  });
  process.on('uncaughtException', (error) => {
    logger.error('process.uncaught_exception', { message: error.message, stack: error.stack });
    process.exit(1);
  });
}

main().catch((error) => {
  logger.error('boot.failed', { message: error.message, stack: error.stack });
  process.exit(1);
});
