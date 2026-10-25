import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ['dist/index.js'],
  env: process.env as Record<string, string>
});
const client = new Client({ name: 'competition-radar-smoke', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
process.stdout.write(`tools: ${tools.tools.map((tool) => tool.name).join(', ')}\n`);

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  if (result.isError) {
    process.stdout.write(`${name}: ERROR ${JSON.stringify(result.content)}\n`);
    return null;
  }
  return result.structuredContent as Record<string, unknown>;
}

const stats = await call('get_stats', {});
process.stdout.write(`stats: ${JSON.stringify(stats)}\n`);

const search = await call('search_competitions', {
  query: '数学',
  live: false,
  limit: 3
});
process.stdout.write(
  `search: total=${search?.total} returned=${search?.returned} cached=${search?.cached}\n`
);
const first = (search?.items as Array<{ id: string; title: string }> | undefined)?.[0];
if (first) {
  process.stdout.write(`first: ${first.id} ${first.title}\n`);
  const detail = await call('get_competition', { id: first.id, include_content: false });
  const item = detail?.item as { title?: string; catalog_id?: string | null } | null;
  process.stdout.write(`detail: ${item?.title} official=${item?.catalog_id ?? 'none'}\n`);
}

const deadlines = await call('list_deadlines', { days: 60, limit: 3 });
process.stdout.write(`deadlines: total=${deadlines?.total}\n`);

const catalog = await call('search_catalog', { query: '数学建模', limit: 3 });
process.stdout.write(`catalog: total=${catalog?.total}\n`);

await client.close();
