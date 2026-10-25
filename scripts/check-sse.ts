import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const url = new URL(process.argv[2] ?? 'http://127.0.0.1:8790/sse');
const transport = new SSEClientTransport(url);
const client = new Client({ name: 'competition-radar-sse-check', version: '0.0.1' });
await client.connect(transport);
const tools = await client.listTools();
const stats = await client.callTool({ name: 'get_stats', arguments: {} });
process.stdout.write(
  JSON.stringify(
    {
      url: url.toString(),
      tools: tools.tools.map((tool) => tool.name),
      competitions: (stats.structuredContent as { competitions?: number })?.competitions
    },
    null,
    2
  ) + '\n'
);
await client.close();
