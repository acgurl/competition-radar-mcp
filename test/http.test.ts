import test from 'node:test';
import assert from 'node:assert/strict';
import { startHttpServer } from '../src/httpServer.js';
import { CompetitionService } from '../src/services/competitions.js';
import { Store } from '../src/store.js';
import type { SaikrAdapter } from '../src/sources/saikr.js';
import type { Jingsai52Adapter } from '../src/sources/jingsai52.js';

const fakeSaikr = {
  search: async () => ({ items: [], total: 0 }),
  list: async () => ({ items: [], total: 0 }),
  detail: async () => {
    throw new Error('not used');
  }
} as unknown as SaikrAdapter;

const fakeJingsai = {
  list: async () => ({ items: [], pageUrl: '', rawHtml: '' }),
  detail: async () => {
    throw new Error('not used');
  }
} as unknown as Jingsai52Adapter;

test('HTTP mode exposes health and requires bearer token on /mcp', async () => {
  const store = new Store(':memory:');
  const service = new CompetitionService({ store, saikr: fakeSaikr, jingsai52: fakeJingsai });
  const http = await startHttpServer(service, {
    host: '127.0.0.1',
    port: 0,
    token: 'test-token'
  });
  const base = `http://127.0.0.1:${http.port}`;
  try {
    const authed = await fetch(`${base}/health`, {
      headers: { Authorization: 'Bearer test-token' }
    });
    assert.equal(authed.status, 200);
    const authedBody = (await authed.json()) as { ok: boolean; competitions: number };
    assert.equal(authedBody.ok, true);
    assert.equal(authedBody.competitions, 0);

    const anonymous = await fetch(`${base}/health`);
    assert.equal(anonymous.status, 200);
    const anonymousBody = (await anonymous.json()) as { ok: boolean; competitions?: number };
    assert.equal(anonymousBody.ok, true);
    assert.equal(anonymousBody.competitions, undefined);

    const unauthorized = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    assert.equal(unauthorized.status, 401);

    const notFound = await fetch(`${base}/nope`);
    assert.equal(notFound.status, 404);
  } finally {
    await http.close();
    service.close();
  }
});
