import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return !/^(0|false|no|off)$/i.test(value);
}

function intEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : fallback;
}

export const config = {
  projectRoot,
  dbPath: process.env.COMP_RADAR_DB
    ? path.resolve(process.cwd(), process.env.COMP_RADAR_DB)
    : path.join(projectRoot, 'data', 'competitions.db'),
  catalogPath: path.join(projectRoot, 'data', 'official-catalog.json'),
  saikrEnabled: boolEnv('SAIKR_ENABLED', true),
  jingsai52Enabled: boolEnv('JINGSAI52_ENABLED', true),
  saikrMinIntervalMs: intEnv('SAIKR_MIN_INTERVAL_MS', 1500),
  jingsai52MinIntervalMs: intEnv('JINGSAI52_MIN_INTERVAL_MS', 2000),
  httpPort: intEnv('COMP_RADAR_HTTP_PORT', 8787),
  httpHost: process.env.COMP_RADAR_HTTP_HOST ?? '127.0.0.1',
  httpToken: process.env.COMP_RADAR_HTTP_TOKEN ?? '',
  logLevel: (process.env.COMP_RADAR_LOG_LEVEL ?? 'info').toLowerCase(),
  listTtlMs: intEnv('COMP_RADAR_LIST_TTL_HOURS', 12) * 3_600_000,
  detailTtlMs: intEnv('COMP_RADAR_DETAIL_TTL_HOURS', 168) * 3_600_000,
  userAgent:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
};
