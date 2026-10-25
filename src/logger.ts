import { config } from './config.js';

const LEVELS: Record<string, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = LEVELS[config.logLevel] ?? LEVELS.info;

function write(level: keyof typeof LEVELS, message: string, meta?: unknown): void {
  if (LEVELS[level] < threshold) return;
  const suffix = meta === undefined ? '' : ` ${JSON.stringify(meta)}`;
  process.stderr.write(`[${new Date().toISOString()}] ${level.toUpperCase()} ${message}${suffix}\n`);
}

export const logger = {
  debug: (message: string, meta?: unknown) => write('debug', message, meta),
  info: (message: string, meta?: unknown) => write('info', message, meta),
  warn: (message: string, meta?: unknown) => write('warn', message, meta),
  error: (message: string, meta?: unknown) => write('error', message, meta)
};
