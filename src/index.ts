#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { config } from './config.js';
import { startHttpServer } from './httpServer.js';
import { logger } from './logger.js';
import { createMcpServer } from './server.js';
import { CompetitionService } from './services/competitions.js';

interface CliOptions {
  http: boolean;
  port: number;
  host: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    http: false,
    port: config.httpPort,
    host: config.httpHost,
    help: false
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--http' || arg === '--sse') options.http = true;
    else if (arg === '--stdio') options.http = false;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg === '--port') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) options.port = value;
      i += 1;
    } else if (arg === '--host') {
      options.host = argv[i + 1] ?? options.host;
      i += 1;
    }
  }
  return options;
}

function printHelp(): void {
  process.stderr.write(`competition-radar-mcp

用法:
  node dist/index.js            以 stdio 模式运行（默认）
  node dist/index.js --http     启动 HTTP 服务（/mcp 与 /sse）
  node dist/index.js --sse      同上，显式使用 SSE 入口
  node dist/index.js --http --port 8787 --host 127.0.0.1

HTTP 端点:
  POST /mcp                     Streamable HTTP
  GET  /sse                     Legacy HTTP+SSE 流
  POST /messages?sessionId=...  SSE 消息入口
  GET  /health                  健康检查

环境变量:
  COMP_RADAR_DB                  SQLite 路径
  SAIKR_ENABLED                  是否启用赛氪（true/false）
  JINGSAI52_ENABLED              是否启用我爱竞赛网（true/false）
  COMP_RADAR_HTTP_TOKEN          HTTP Bearer Token
  COMP_RADAR_HTTP_PORT           HTTP 端口
  COMP_RADAR_HTTP_HOST           HTTP 监听地址
  COMP_RADAR_LIST_TTL_HOURS      列表缓存 TTL
  COMP_RADAR_DETAIL_TTL_HOURS    详情缓存 TTL
  COMP_RADAR_LOG_LEVEL           debug/info/warn/error
`);
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const service = new CompetitionService();
  await service.init();

  if (options.http) {
    const http = await startHttpServer(service, {
      host: options.host,
      port: options.port,
      token: config.httpToken
    });
    process.stderr.write(
      `competition-radar MCP listening on http://${options.host}:${http.port} (streamable: /mcp, sse: /sse)\n`
    );

    const shutdown = async () => {
      logger.info('shutting down');
      await http.close();
      service.close();
      process.exit(0);
    };
    process.once('SIGINT', () => void shutdown());
    process.once('SIGTERM', () => void shutdown());
    return;
  }

  const server = createMcpServer(service);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  logger.info('stdio server started');

  const shutdown = async () => {
    await server.close().catch(() => undefined);
    service.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  logger.error('fatal', { error: error instanceof Error ? error.stack ?? error.message : String(error) });
  process.exit(1);
});
