import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createMcpServer } from '../src/server.js';
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

test('MCP server exposes tools and serves requests over in-memory transport', async () => {
  const store = new Store(':memory:');
  const service = new CompetitionService({ store, saikr: fakeSaikr, jingsai52: fakeJingsai });
  const server = createMcpServer(service);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test-client', version: '0.0.1' });
  await client.connect(clientTransport);

  const tools = await client.listTools();
  const names = tools.tools.map((tool) => tool.name).sort();
  assert.deepEqual(names, [
    'get_competition',
    'get_stats',
    'list_deadlines',
    'list_sources',
    'refresh_data',
    'search_catalog',
    'search_competitions'
  ]);

  const stats = await client.callTool({ name: 'get_stats', arguments: {} });
  assert.equal(stats.isError, false);
  assert.equal((stats.structuredContent as { competitions: number }).competitions, 0);

  const search = await client.callTool({
    name: 'search_competitions',
    arguments: { live: false, limit: 5 }
  });
  assert.equal(search.isError, false);
  assert.equal((search.structuredContent as { total: number }).total, 0);

  const sources = await client.callTool({ name: 'list_sources', arguments: {} });
  assert.equal(sources.isError, false);
  assert.equal((sources.structuredContent as { sources: unknown[] }).sources.length, 3);

  const invalid = await client.callTool({ name: 'get_competition', arguments: {} });
  assert.equal(invalid.isError, true);

  await client.close();
  await server.close();
  service.close();
});
