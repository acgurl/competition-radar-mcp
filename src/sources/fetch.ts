import iconv from 'iconv-lite';
import { config } from '../config.js';
import { logger } from '../logger.js';

export class HttpError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number | null = null,
    public readonly retryable = false
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class HostRateLimiter {
  private last = new Map<string, number>();
  private chains = new Map<string, Promise<unknown>>();

  async run<T>(url: string, minIntervalMs: number, fn: () => Promise<T>): Promise<T> {
    const host = new URL(url).host;
    const previous = this.chains.get(host) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      const elapsed = Date.now() - (this.last.get(host) ?? 0);
      const delay = minIntervalMs - elapsed;
      if (delay > 0) await sleep(delay);
      try {
        return await fn();
      } finally {
        this.last.set(host, Date.now());
      }
    });
    this.chains.set(host, task);
    return task;
  }
}

const limiter = new HostRateLimiter();

export interface FetchOptions {
  headers?: Record<string, string>;
  encoding?: 'utf8' | 'gb18030' | 'gbk';
  minIntervalMs?: number;
  timeoutMs?: number;
  retries?: number;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const {
    headers = {},
    encoding = 'utf8',
    minIntervalMs = 0,
    timeoutMs = 25_000,
    retries = 2
  } = options;

  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await limiter.run(url, minIntervalMs, async () => {
        const response = await fetch(url, {
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
          headers: {
            'User-Agent': config.userAgent,
            Accept: 'text/html,application/json,application/xhtml+xml,*/*;q=0.8',
            'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.6',
            ...headers
          }
        });
        if (!response.ok) {
          throw new HttpError(
            `HTTP_${response.status}`,
            `${url} returned ${response.status}`,
            response.status,
            response.status === 429 || response.status >= 500
          );
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (encoding === 'gb18030' || encoding === 'gbk') {
          return iconv.decode(buffer, 'gb18030');
        }
        return buffer.toString('utf8');
      });
    } catch (error) {
      lastError = error;
      const retryable = error instanceof HttpError ? error.retryable : true;
      if (attempt >= retries || !retryable) break;
      const delay = 1_000 * (attempt + 1);
      logger.warn(`request failed, retrying in ${delay}ms`, {
        url,
        error: error instanceof Error ? error.message : String(error)
      });
      await sleep(delay);
    }
  }

  if (lastError instanceof HttpError) throw lastError;
  throw new HttpError(
    'NETWORK_ERROR',
    lastError instanceof Error ? lastError.message : String(lastError),
    null,
    true
  );
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const text = await fetchText(url, {
    ...options,
    headers: { Accept: 'application/json, text/plain, */*', ...options.headers }
  });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError('INVALID_JSON', `${url} did not return valid JSON`, null, false);
  }
}
