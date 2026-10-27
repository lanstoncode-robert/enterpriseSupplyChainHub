export const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

/**
 * Minimal structured JSON logger. One JSON object per line keeps container
 * logs queryable without pulling in pino/winston.
 */
export function createLogger({ level = 'info', stream = process.stdout, base = {} } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;
  const write = (entryLevel, message, fields = {}) => {
    if ((LEVELS[entryLevel] ?? 20) < threshold) return;
    const record = {
      ts: new Date().toISOString(),
      level: entryLevel,
      msg: message,
      ...base,
      ...fields,
    };
    try {
      stream.write(`${JSON.stringify(record)}\n`);
    } catch {
      /* logging must never crash a request */
    }
  };
  const logger = {
    level,
    debug: (message, fields) => write('debug', message, fields),
    info: (message, fields) => write('info', message, fields),
    warn: (message, fields) => write('warn', message, fields),
    error: (message, fields) => write('error', message, fields),
    child: (fields) => createLogger({ level, stream, base: { ...base, ...fields } }),
  };
  return logger;
}
