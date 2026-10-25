import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { CATEGORIES, LEVELS, SOURCE_IDS, STATUSES, type Category, type Level, type SourceId, type Status } from './types.js';
import type { CompetitionService } from './services/competitions.js';

function jsonResult(data: Record<string, unknown>, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }],
    structuredContent: data,
    isError
  };
}

function failure(error: unknown) {
  return jsonResult(
    {
      error: error instanceof Error ? error.message : String(error),
      code: 'INTERNAL_ERROR'
    },
    true
  );
}

export function createMcpServer(service: CompetitionService): McpServer {
  const server = new McpServer({
    name: 'competition-radar',
    version: '0.1.0'
  });

  server.registerTool(
    'search_competitions',
    {
      title: '搜索竞赛',
      description:
        '按关键词、类别、级别、状态、报名截止时间搜索竞赛。默认会查询本地缓存，并在有关键词时向赛氪做一次在线补充（可用 live=false 关闭）。',
      inputSchema: {
        query: z
          .string()
          .optional()
          .describe('关键词，多个词用空格分隔，按 AND 匹配标题/摘要/主办方'),
        source: z.enum(SOURCE_IDS).optional().describe('限定数据源'),
        category: z.enum(CATEGORIES).optional().describe('竞赛类别'),
        level: z.enum(LEVELS).optional().describe('竞赛级别'),
        status: z.enum(STATUSES).optional().describe('竞赛状态（按当前时间计算）'),
        deadline_within_days: z
          .number()
          .int()
          .min(1)
          .max(365)
          .optional()
          .describe('只看 N 天内报名截止的竞赛'),
        official_only: z.boolean().optional().describe('只返回官方 84 项目录命中的赛事'),
        include_past: z.boolean().optional().describe('是否包含已结束赛事，默认 false'),
        live: z.boolean().optional().describe('有 query 时是否在线补充赛氪结果，默认 true'),
        sort: z
          .enum(['relevance', 'deadline', 'event_start', 'updated'])
          .optional()
          .describe('排序方式，默认 relevance'),
        limit: z.number().int().min(1).max(50).optional().describe('返回条数，默认 10'),
        offset: z.number().int().min(0).optional().describe('分页偏移，默认 0')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        const result = await service.search({
          ...args,
          category: args.category as Category | undefined,
          level: args.level as Level | undefined,
          status: args.status as Status | undefined,
          source: args.source as SourceId | undefined
        });
        return jsonResult(result as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_competition',
    {
      title: '获取竞赛详情',
      description:
        '按 id（如 saikr:58100 / jingsai52:24110）或 source+source_id 获取竞赛详情。首次访问会按需抓取正文并缓存。',
      inputSchema: {
        id: z.string().optional().describe('统一 ID：source:source_id'),
        source: z.enum(SOURCE_IDS).optional().describe('数据源；与 source_id 搭配使用'),
        source_id: z.string().optional().describe('源站 ID'),
        include_content: z.boolean().optional().describe('是否返回正文，默认 true'),
        refresh: z.boolean().optional().describe('忽略详情缓存强制刷新，默认 false')
      },
      annotations: { readOnlyHint: true, openWorldHint: true }
    },
    async (args) => {
      try {
        if (!args.id && !(args.source && args.source_id)) {
          return jsonResult(
            { error: '需要提供 id，或同时提供 source 与 source_id', code: 'INVALID_INPUT' },
            true
          );
        }
        const result = await service.getCompetition({
          ...args,
          source: args.source as SourceId | undefined
        });
        return jsonResult(result as unknown as Record<string, unknown>, !result.item);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_deadlines',
    {
      title: '报名截止日历',
      description: '列出未来 N 天内报名截止的竞赛，按截止时间升序，适合整理周报/提醒。',
      inputSchema: {
        days: z.number().int().min(1).max(180).optional().describe('未来天数，默认 30'),
        category: z.enum(CATEGORIES).optional().describe('竞赛类别'),
        level: z.enum(LEVELS).optional().describe('竞赛级别'),
        official_only: z.boolean().optional().describe('只看官方目录赛事'),
        limit: z.number().int().min(1).max(100).optional().describe('返回条数，默认 20')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        const result = await service.listDeadlines({
          ...args,
          category: args.category as Category | undefined,
          level: args.level as Level | undefined
        });
        return jsonResult(result as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'search_catalog',
    {
      title: '查询官方竞赛目录',
      description:
        '查询全国普通高校大学生竞赛排行榜核心赛事（84 项），可按名称、常见月份、类别筛选，并返回官网与已收录赛事数。',
      inputSchema: {
        query: z.string().optional().describe('赛事名称关键词'),
        month: z.number().int().min(1).max(12).optional().describe('常见报名月份'),
        category: z.enum(CATEGORIES).optional().describe('竞赛类别'),
        limit: z.number().int().min(1).max(84).optional().describe('返回条数，默认 20')
      },
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async (args) => {
      try {
        const result = await service.searchCatalog({
          ...args,
          category: args.category as Category | undefined
        });
        return jsonResult(result as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'list_sources',
    {
      title: '查看数据源状态',
      description: '查看各数据源是否启用、能力、限流、上次同步时间、收录数量与最近错误。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return jsonResult({ sources: service.listSources() });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'refresh_data',
    {
      title: '刷新竞赛数据',
      description:
        '主动抓取指定数据源。默认 all + 3 页；赛氪每页 100 条，我爱竞赛网默认 6 个频道。只刷新列表，不抓详情。',
      inputSchema: {
        source: z
          .enum(['all', 'saikr', 'jingsai52', 'catalog'])
          .optional()
          .describe('要刷新的源，默认 all'),
        max_pages: z.number().int().min(1).max(20).optional().describe('每个源/频道最多页数，默认 3'),
        force: z.boolean().optional().describe('忽略 TTL 强制刷新，默认 false')
      },
      annotations: { readOnlyHint: false, openWorldHint: true }
    },
    async (args) => {
      try {
        const results = await service.refresh(args);
        return jsonResult({ results });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'get_stats',
    {
      title: '缓存统计',
      description: '返回缓存中的竞赛总数、来源/状态/类别分布、官方命中数与最近同步时间。',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false }
    },
    async () => {
      try {
        return jsonResult(service.stats() as unknown as Record<string, unknown>);
      } catch (error) {
        return failure(error);
      }
    }
  );

  return server;
}
