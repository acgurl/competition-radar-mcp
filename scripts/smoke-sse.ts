import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { startHttpServer } from '../src/httpServer.js';
import { CompetitionService } from '../src/services/competitions.js';

const token = 'smoke-token';
const service = new CompetitionService();
await service.init();
const http = await startHttpServer(service, { host: '127.0.0.1', port: 0, token });
const url = new URL(`http://127.0.0.1:${http.port}/sse?token=${encodeURIComponent(token)}`);
const transport = new SSEClientTransport(url);
const client = new Client({ name: 'competition-radar-sse-smoke', version: '0.0.1' });
await client.connect(transport);

const tools = await client.listTools();
process.stdout.write(`sse tools: ${tools.tools.length}\n`);
const stats = await client.callTool({ name: 'get_stats', arguments: {} });
process.stdout.write(`sse stats: ${JSON.stringify(stats.structuredContent)}\n`);

await client.close();
await http.close();
service.close();
