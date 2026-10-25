import { randomUUID, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createMcpServer } from './server.js';
import { logger } from './logger.js';
import type { CompetitionService } from './services/competitions.js';

export interface HttpServerOptions {
  host: string;
  port: number;
  token: string;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
}

interface SseSession {
  transport: SSEServerTransport;
  server: McpServer;
}

function isLoopback(host: string): boolean {
  return host === '127.0.0.1' || host === 'localhost' || host === '::1';
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Expose-Headers': 'Mcp-Session-Id'
  });
  res.end(payload);
}

function sendRpcError(res: ServerResponse, status: number, message: string): void {
  sendJson(res, status, {
    jsonrpc: '2.0',
    error: { code: -32001, message },
    id: null
  });
}

function authorized(header: string | undefined, token: string): boolean {
  if (!token) return true;
  const match = header?.match(/^Bearer\s+(.+)$/i);
  if (!match) return false;
  const provided = Buffer.from(match[1]);
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function tokenMatches(value: string, token: string): boolean {
  if (!token) return true;
  const provided = Buffer.from(value);
  const expected = Buffer.from(token);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function requestAuthorized(req: IncomingMessage, url: URL, token: string): boolean {
  if (authorized(req.headers.authorization, token)) return true;
  const queryToken = url.searchParams.get('token');
  return Boolean(queryToken && tokenMatches(queryToken, token));
}

function applyCors(res: ServerResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version'
  );
  res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id');
}

export async function startHttpServer(
  service: CompetitionService,
  options: HttpServerOptions
): Promise<{ port: number; close: () => Promise<void> }> {
  if (!isLoopback(options.host) && !options.token) {
    throw new Error('COMP_RADAR_HTTP_TOKEN is required when listening on a non-loopback host');
  }

  const sessions = new Map<string, Session>();
  const sseSessions = new Map<string, SseSession>();

  const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    applyCors(res);
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      if (url.pathname === '/health') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed' });
          return;
        }
        const authed = requestAuthorized(req, url, options.token);
        sendJson(res, 200, authed ? { ok: true, ...service.stats() } : { ok: true });
        return;
      }

      // Legacy HTTP+SSE transport (protocol 2024-11-05)
      if (url.pathname === '/sse') {
        if (req.method !== 'GET') {
          sendJson(res, 405, { error: 'method not allowed; use GET for SSE' });
          return;
        }
        if (!requestAuthorized(req, url, options.token)) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        const endpoint = options.token
          ? `/messages?token=${encodeURIComponent(options.token)}`
          : '/messages';
        const transport = new SSEServerTransport(endpoint, res);
        const sessionId = transport.sessionId;
        const mcp = createMcpServer(service);
        sseSessions.set(sessionId, { transport, server: mcp });
        transport.onclose = () => {
          sseSessions.delete(sessionId);
          logger.info('sse session closed', { sessionId });
        };
        await mcp.connect(transport);
        logger.info('sse session started', { sessionId });
        return;
      }

      if (url.pathname === '/messages') {
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'method not allowed; use POST for messages' });
          return;
        }
        if (!requestAuthorized(req, url, options.token)) {
          sendJson(res, 401, { error: 'unauthorized' });
          return;
        }
        const sessionId = url.searchParams.get('sessionId');
        if (!sessionId) {
          sendJson(res, 400, { error: 'missing sessionId parameter' });
          return;
        }
        const session = sseSessions.get(sessionId);
        if (!session) {
          sendRpcError(res, 404, 'session not found');
          return;
        }
        await session.transport.handlePostMessage(req, res);
        return;
      }

      if (url.pathname !== '/mcp') {
        sendJson(res, 404, { error: 'not found; use /mcp, /sse or /messages' });
        return;
      }

      if (!requestAuthorized(req, url, options.token)) {
        sendJson(res, 401, { error: 'unauthorized' });
        return;
      }

      const sessionHeader = req.headers['mcp-session-id'];
      const sessionId = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader;
      if (sessionId) {
        const session = sessions.get(sessionId);
        if (!session) {
          sendRpcError(res, 404, 'session not found');
          return;
        }
        await session.transport.handleRequest(req, res);
        return;
      }

      if (req.method !== 'POST') {
        sendRpcError(res, 400, 'missing mcp-session-id');
        return;
      }

      let session: Session;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          sessions.set(id, session);
        }
      });
      const mcp = createMcpServer(service);
      session = { transport, server: mcp };
      transport.onclose = () => {
        if (transport.sessionId) sessions.delete(transport.sessionId);
      };
      await mcp.connect(transport);
      await transport.handleRequest(req, res);
    } catch (error) {
      logger.error('http request failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!res.headersSent) {
        sendJson(res, 500, { error: 'internal server error' });
      } else {
        res.end();
      }
    }
  });

  httpServer.requestTimeout = 0;
  await new Promise<void>((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(options.port, options.host, () => resolve());
  });
  const address = httpServer.address();
  const port = typeof address === 'object' && address ? address.port : options.port;
  logger.info('http server started', {
    host: options.host,
    port,
    endpoints: ['/mcp', '/sse', '/messages', '/health']
  });

  return {
    port,
    close: async () => {
      for (const session of [...sseSessions.values()]) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }
      sseSessions.clear();
      for (const session of sessions.values()) {
        await session.transport.close().catch(() => undefined);
        await session.server.close().catch(() => undefined);
      }
      sessions.clear();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}
