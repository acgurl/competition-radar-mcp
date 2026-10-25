import { stat } from 'node:fs/promises';
import { config } from '../config.js';
import { logger } from '../logger.js';
import { readCatalog } from '../sources/catalog.js';
import { Jingsai52Adapter, DEFAULT_JINGSAI_CHANNELS } from '../sources/jingsai52.js';
import { SaikrAdapter } from '../sources/saikr.js';
import { HttpError } from '../sources/fetch.js';
import {
  canonicalKey,
  computeStatus,
  daysUntil,
  matchCatalog,
  nowIso
} from '../normalize.js';
import { Store } from '../store.js';
import type {
  CatalogItem,
  CatalogSearchResult,
  Category,
  Competition,
  CompetitionDetail,
  CompetitionSummary,
  DeadlineResult,
  Level,
  SearchOptions,
  SearchResult,
  SourceId,
  SourceRef,
  StatsResult,
  Status,
  SyncResult,
  ToolError
} from '../types.js';

interface ServiceOptions {
  store?: Store;
  saikr?: SaikrAdapter;
  jingsai52?: Jingsai52Adapter;
}

interface GetOptions {
  id?: string;
  source?: SourceId;
  source_id?: string;
  include_content?: boolean;
  refresh?: boolean;
}

interface DeadlineOptions {
  days?: number;
  category?: Category;
  level?: Level;
  official_only?: boolean;
  limit?: number;
}

interface RefreshOptions {
  source?: 'all' | SourceId | 'catalog';
  max_pages?: number;
  force?: boolean;
}

function errorToToolError(source: string, error: unknown): ToolError {
  if (error instanceof HttpError) {
    return { source, code: error.code, message: error.message, retryable: error.retryable };
  }
  return {
    source,
    code: 'ERROR',
    message: error instanceof Error ? error.message : String(error),
    retryable: true
  };
}

function statusOf(c: Competition, now = Date.now()): Status {
  return computeStatus(c, now);
}

function completeness(c: Competition): number {
  let score = 0;
  if (c.registration_start) score += 3;
  if (c.registration_end) score += 3;
  if (c.event_start) score += 2;
  if (c.event_end) score += 2;
  if (c.summary) score += 1;
  if (c.cover_url) score += 1;
  if (c.organizer.length) score += 1;
  if (c.official) score += 4;
  if (c.source === 'saikr') score += 0.5;
  return score;
}

function sourceRef(c: Competition): SourceRef {
  return { source: c.source, id: c.id, url: c.url, title: c.title };
}

export class CompetitionService {
  readonly store: Store;
  readonly saikr: SaikrAdapter;
  readonly jingsai52: Jingsai52Adapter;
  private catalogItems: CatalogItem[] = [];

  constructor(options: ServiceOptions = {}) {
    this.store = options.store ?? new Store();
    this.saikr = options.saikr ?? new SaikrAdapter();
    this.jingsai52 = options.jingsai52 ?? new Jingsai52Adapter();
  }

  async init(): Promise<void> {
    await this.ensureCatalog();
  }

  async ensureCatalog(): Promise<void> {
    const existingVersion = this.store.getMeta('catalog_version');
    const current = this.store.allCatalog();
    if (current.length) {
      this.catalogItems = current;
    }
    try {
      const { meta, items } = await readCatalog(config.catalogPath);
      const mtime = String((await stat(config.catalogPath)).mtimeMs);
      const currentMtime = this.store.getMeta('catalog_mtime');
      if (!current.length || existingVersion !== meta.version || currentMtime !== mtime) {
        this.store.loadCatalog(items);
        this.store.applyCatalogMatches(items);
        this.store.setMeta('catalog_version', meta.version);
        this.store.setMeta('catalog_mtime', mtime);
        this.catalogItems = items;
        logger.info('catalog loaded', { version: meta.version, items: items.length });
      }
    } catch (error) {
      logger.warn('catalog load failed', {
        error: error instanceof Error ? error.message : String(error)
      });
      if (!this.catalogItems.length) this.catalogItems = this.store.allCatalog();
    }
  }

  private attachCatalog(competition: Competition): Competition {
    if (!this.catalogItems.length) return competition;
    const hit = matchCatalog(competition.title, this.catalogItems);
    if (!hit) {
      if (competition.official) {
        return { ...competition, official: false, catalog_id: null, catalog_url: null };
      }
      return competition;
    }
    return {
      ...competition,
      official: true,
      catalog_id: hit.item.id,
      catalog_url: hit.item.url
    };
  }

  private toSummary(c: Competition, now = Date.now()): CompetitionSummary {
    return {
      ...c,
      status: statusOf(c, now),
      sources: [sourceRef(c)]
    };
  }

  private groupAndDedupe(items: Competition[], now = Date.now()): CompetitionSummary[] {
    const groups = new Map<string, Competition[]>();
    for (const item of items) {
      const key = item.canonical_key || item.id;
      const list = groups.get(key) ?? [];
      list.push(item);
      groups.set(key, list);
    }

    const summaries: CompetitionSummary[] = [];
    for (const group of groups.values()) {
      group.sort((a, b) => completeness(b) - completeness(a));
      const primary = group[0];
      const refs = new Map<string, SourceRef>();
      for (const item of group) refs.set(item.id, sourceRef(item));
      summaries.push({
        ...primary,
        status: statusOf(primary, now),
        sources: [...refs.values()],
        days_left: daysUntil(primary.registration_end, now) ?? undefined
      });
    }
    return summaries;
  }

  private filterAndSort(
    items: CompetitionSummary[],
    options: SearchOptions,
    now = Date.now()
  ): CompetitionSummary[] {
    const tokens = (options.query ?? '').split(/\s+/).filter(Boolean);
    const deadlineLimit =
      options.deadline_within_days === undefined
        ? null
        : now + Math.max(1, options.deadline_within_days) * 86_400_000;

    let filtered = items.filter((item) => {
      if (options.status && item.status !== options.status) return false;
      if (!options.include_past && item.status === 'ended' && options.status !== 'ended') return false;
      if (deadlineLimit !== null) {
        if (!item.registration_end) return false;
        const end = Date.parse(item.registration_end);
        if (Number.isNaN(end) || end < now || end > deadlineLimit) return false;
      }
      return true;
    });

    const relevance = (item: CompetitionSummary): number => {
      if (!tokens.length) return 0;
      const title = item.title.toLowerCase();
      const summary = (item.summary ?? '').toLowerCase();
      let score = 0;
      for (const token of tokens) {
        const t = token.toLowerCase();
        if (title.includes(t)) score += 3;
        if (summary.includes(t)) score += 1;
      }
      if (tokens.every((token) => title.includes(token.toLowerCase()))) score += 5;
      if (item.official) score += 2;
      if (item.status === 'registering') score += 1;
      return score;
    };

    const byDeadline = (a: CompetitionSummary, b: CompetitionSummary): number => {
      const aEnd = a.registration_end ? Date.parse(a.registration_end) : Number.POSITIVE_INFINITY;
      const bEnd = b.registration_end ? Date.parse(b.registration_end) : Number.POSITIVE_INFINITY;
      return aEnd - bEnd;
    };

    switch (options.sort ?? 'relevance') {
      case 'deadline':
        filtered = filtered.sort((a, b) => byDeadline(a, b) || a.title.localeCompare(b.title));
        break;
      case 'event_start':
        filtered = filtered.sort((a, b) => {
          const aStart = a.event_start ? Date.parse(a.event_start) : Number.POSITIVE_INFINITY;
          const bStart = b.event_start ? Date.parse(b.event_start) : Number.POSITIVE_INFINITY;
          return aStart - bStart;
        });
        break;
      case 'updated':
        filtered = filtered.sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at));
        break;
      default:
        filtered = filtered.sort((a, b) => {
          const diff = relevance(b) - relevance(a);
          if (diff !== 0) return diff;
          return byDeadline(a, b);
        });
    }
    return filtered;
  }

  async search(options: SearchOptions = {}): Promise<SearchResult> {
    const now = Date.now();
    const errors: ToolError[] = [];
    const query = options.query?.trim() ?? '';
    const shouldLive =
      Boolean(query) &&
      options.live !== false &&
      (!options.source || options.source === 'saikr') &&
      config.saikrEnabled;

    let liveAttempted = false;
    let sourceTotal: number | undefined;
    if (shouldLive) {
      liveAttempted = true;
      try {
        const result = await this.saikr.search(query, 50);
        sourceTotal = result.total;
        const items = result.items.map((item) => this.attachCatalog(item));
        this.store.upsertCompetitions(items);
      } catch (error) {
        errors.push(errorToToolError('saikr', error));
      }
    }

    let candidates = this.store.searchCandidates({
      query,
      source: options.source,
      category: options.category,
      level: options.level,
      officialOnly: options.official_only
    });

    // live search may have failed; still try cache. If cache is empty and no query, suggest refresh.
    let summaries = this.groupAndDedupe(candidates, now);
    summaries = this.filterAndSort(summaries, options, now);

    const total = summaries.length;
    const offset = Math.max(0, options.offset ?? 0);
    const limit = Math.min(50, Math.max(1, options.limit ?? 10));
    const page = summaries.slice(offset, offset + limit);

    return {
      total,
      returned: page.length,
      items: page,
      errors,
      cached: !liveAttempted || errors.length > 0,
      source_total: sourceTotal
    };
  }

  private baseFromPartial(
    resolved: { source: SourceId; source_id: string; url: string },
    partial: Partial<Competition>
  ): Competition {
    const now = nowIso();
    const title = partial.title?.trim() || `${resolved.source}:${resolved.source_id}`;
    return {
      id: `${resolved.source}:${resolved.source_id}`,
      source: resolved.source,
      source_id: resolved.source_id,
      title,
      url: partial.url ?? resolved.url,
      summary: partial.summary ?? null,
      cover_url: partial.cover_url ?? null,
      organizer: partial.organizer ?? [],
      level: partial.level ?? 'unknown',
      level_label: partial.level_label ?? null,
      category: partial.category ?? 'unknown',
      category_label: partial.category_label ?? null,
      tags: partial.tags ?? [],
      registration_start: partial.registration_start ?? null,
      registration_end: partial.registration_end ?? null,
      event_start: partial.event_start ?? null,
      event_end: partial.event_end ?? null,
      fee: partial.fee ?? null,
      eligibility: partial.eligibility ?? null,
      format: partial.format ?? 'unknown',
      official: partial.official ?? false,
      catalog_id: partial.catalog_id ?? null,
      catalog_url: partial.catalog_url ?? null,
      canonical_key: partial.canonical_key ?? canonicalKey(title),
      fetched_at: partial.fetched_at ?? now,
      updated_at: partial.updated_at ?? now
    };
  }

  private resolveId(options: GetOptions): { id: string; source?: SourceId; source_id?: string } {
    if (options.id) {
      const [source, ...rest] = options.id.split(':');
      if (rest.length && (source === 'saikr' || source === 'jingsai52')) {
        return { id: options.id, source, source_id: rest.join(':') };
      }
      return { id: options.id };
    }
    if (options.source && options.source_id) {
      return {
        id: `${options.source}:${options.source_id}`,
        source: options.source,
        source_id: options.source_id
      };
    }
    return { id: '' };
  }

  async getCompetition(options: GetOptions = {}): Promise<{
    item: CompetitionDetail | null;
    errors: ToolError[];
  }> {
    const resolved = this.resolveId(options);
    if (!resolved.id) {
      return {
        item: null,
        errors: [{ source: 'input', code: 'INVALID_INPUT', message: 'id or source+source_id is required', retryable: false }]
      };
    }

    let record = this.store.getCompetition(resolved.id);
    let detail = this.store.getDetail(resolved.id);
    const errors: ToolError[] = [];
    const includeContent = options.include_content !== false;
    const now = Date.now();

    const needsFetch =
      (includeContent || !record) &&
      (options.refresh ||
        !detail ||
        now - Date.parse(detail.fetched_at) > config.detailTtlMs ||
        !record);

    if (needsFetch && resolved.source && resolved.source_id) {
      try {
        if (resolved.source === 'saikr') {
          const result = await this.saikr.detail(resolved.source_id);
          const incoming = this.attachCatalog(result.competition);
          this.store.upsertCompetition(incoming);
          record = this.store.getCompetition(incoming.id) ?? incoming;
          detail = {
            content: result.content,
            links: result.links,
            extracted: result.extracted,
            fetched_at: nowIso()
          };
          this.store.saveDetail(incoming.id, detail);
        } else {
          const url =
            record?.url ?? `https://www.52jingsai.com/article-${resolved.source_id}-1.html`;
          const result = await this.jingsai52.detail(url);
          const incoming = this.baseFromPartial(
            { source: 'jingsai52', source_id: resolved.source_id, url },
            { ...result.competition, title: result.competition.title ?? record?.title }
          );
          const enriched = this.attachCatalog(incoming);
          this.store.upsertCompetition(enriched);
          record = this.store.getCompetition(enriched.id) ?? enriched;
          detail = {
            content: result.content,
            links: result.links,
            extracted: result.extracted,
            fetched_at: nowIso()
          };
          this.store.saveDetail(enriched.id, detail);
        }
      } catch (error) {
        errors.push(errorToToolError(resolved.source, error));
      }
    }

    if (!record) {
      if (!errors.length) {
        errors.push({
          source: resolved.source ?? 'cache',
          code: 'NOT_FOUND',
          message: 'competition not found; run search or refresh_data first',
          retryable: false
        });
      }
      return { item: null, errors };
    }

    const summary = this.toSummary(record);
    const catalog = record.catalog_id ? this.store.getCatalogItem(record.catalog_id) : null;
    const maxContent = 20_000;
    const content = includeContent && detail ? detail.content : undefined;
    const truncated = Boolean(content && content.length > maxContent);

    return {
      item: {
        ...summary,
        content: content ? content.slice(0, maxContent) : undefined,
        content_truncated: truncated,
        links: includeContent && detail ? detail.links : undefined,
        extracted: includeContent && detail ? detail.extracted ?? undefined : undefined,
        catalog
      },
      errors
    };
  }

  async listDeadlines(options: DeadlineOptions = {}): Promise<DeadlineResult> {
    const now = Date.now();
    const days = Math.min(180, Math.max(1, options.days ?? 30));
    const all = this.store.allCompetitions();
    const grouped = this.groupAndDedupe(all, now);
    const filtered = grouped
      .filter((item) => {
        if (!item.registration_end) return false;
        const endMs = Date.parse(item.registration_end);
        if (Number.isNaN(endMs) || endMs < now) return false;
        const left = daysUntil(item.registration_end, now);
        if (left === null || left > days) return false;
        if (options.category && item.category !== options.category) return false;
        if (options.level && item.level !== options.level) return false;
        if (options.official_only && !item.official) return false;
        return true;
      })
      .sort((a, b) => Date.parse(a.registration_end!) - Date.parse(b.registration_end!));

    const limit = Math.min(100, Math.max(1, options.limit ?? 20));
    const items = filtered.slice(0, limit).map((item) => ({
      ...item,
      days_left: daysUntil(item.registration_end, now) ?? 0
    }));
    return { total: filtered.length, returned: items.length, items, errors: [] };
  }

  async searchCatalog(options: {
    query?: string;
    month?: number;
    category?: Category;
    limit?: number;
  } = {}): Promise<CatalogSearchResult> {
    if (!this.catalogItems.length) await this.ensureCatalog();
    const all = this.store.queryCatalog({ ...options, limit: 200 });
    const limit = Math.min(200, Math.max(1, options.limit ?? 20));
    const items = all.slice(0, limit);
    const counts = this.store.countCompetitionsByCatalog();
    return {
      total: all.length,
      returned: items.length,
      items: items.map((item) => ({ ...item, matched_competitions: counts[item.id] ?? 0 }))
    };
  }

  async refresh(options: RefreshOptions = {}): Promise<SyncResult[]> {
    const source = options.source ?? 'all';
    const maxPages = Math.min(20, Math.max(1, options.max_pages ?? 3));
    const force = options.force ?? false;
    const results: SyncResult[] = [];

    if (source === 'catalog' || source === 'all') {
      const started = Date.now();
      try {
        const { meta, items } = await readCatalog(config.catalogPath);
        const mtime = String((await stat(config.catalogPath)).mtimeMs);
        this.store.loadCatalog(items);
        const applied = this.store.applyCatalogMatches(items);
        this.catalogItems = items;
        this.store.setMeta('catalog_version', meta.version);
        this.store.setMeta('catalog_mtime', mtime);
        this.store.setSourceState('catalog', { last_sync: nowIso(), last_error: null, item_count: items.length });
        results.push({
          source: 'catalog',
          added: 0,
          updated: applied.changed,
          unchanged: 0,
          matched: applied.matched,
          duration_ms: Date.now() - started
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.store.setSourceState('catalog', { last_error: message });
        results.push({
          source: 'catalog',
          added: 0,
          updated: 0,
          unchanged: 0,
          duration_ms: Date.now() - started,
          error: message
        });
      }
    }

    if (source === 'saikr' || source === 'all') {
      if (config.saikrEnabled) {
        results.push(await this.refreshSaikr(maxPages, force));
      } else {
        results.push({ source: 'saikr', added: 0, updated: 0, unchanged: 0, duration_ms: 0, skipped: true, error: 'disabled' });
      }
    }
    if (source === 'jingsai52' || source === 'all') {
      if (config.jingsai52Enabled) {
        results.push(await this.refreshJingsai52(maxPages, force));
      } else {
        results.push({ source: 'jingsai52', added: 0, updated: 0, unchanged: 0, duration_ms: 0, skipped: true, error: 'disabled' });
      }
    }
    return results;
  }

  private async refreshSaikr(maxPages: number, force: boolean): Promise<SyncResult> {
    const started = Date.now();
    const state = this.store.getSourceState('saikr');
    const lastSync = state?.last_sync ? Date.parse(state.last_sync) : 0;
    if (!force && lastSync && Date.now() - lastSync < config.listTtlMs) {
      return { source: 'saikr', added: 0, updated: 0, unchanged: 0, duration_ms: 0, skipped: true };
    }
    const totals = { added: 0, updated: 0, unchanged: 0 };
    let errorMessage: string | undefined;
    try {
      for (let page = 1; page <= maxPages; page += 1) {
        const result = await this.saikr.list({ page, limit: 100, sort: 0 });
        if (!result.items.length) break;
        const enriched = result.items.map((item) => this.attachCatalog(item));
        const counts = this.store.upsertCompetitions(enriched);
        totals.added += counts.added;
        totals.updated += counts.updated;
        totals.unchanged += counts.unchanged;
        logger.info('saikr page synced', { page, items: result.items.length });
      }
      this.store.setSourceState('saikr', { last_sync: nowIso(), last_error: null });
    } catch (error) {
      errorMessage = error instanceof Error ? error.message : String(error);
      this.store.setSourceState('saikr', { last_error: errorMessage });
      logger.warn('saikr refresh failed', { error: errorMessage });
    }
    this.store.setSourceState('saikr', { item_count: this.store.countBy('source').saikr ?? 0 });
    return {
      source: 'saikr',
      added: totals.added,
      updated: totals.updated,
      unchanged: totals.unchanged,
      duration_ms: Date.now() - started,
      error: errorMessage
    };
  }

  private async refreshJingsai52(maxPages: number, force: boolean): Promise<SyncResult> {
    const started = Date.now();
    const state = this.store.getSourceState('jingsai52');
    const lastSync = state?.last_sync ? Date.parse(state.last_sync) : 0;
    if (!force && lastSync && Date.now() - lastSync < config.listTtlMs) {
      return { source: 'jingsai52', added: 0, updated: 0, unchanged: 0, duration_ms: 0, skipped: true };
    }
    const totals = { added: 0, updated: 0, unchanged: 0 };
    const errors: string[] = [];
    for (const channel of DEFAULT_JINGSAI_CHANNELS) {
      try {
        for (let page = 1; page <= maxPages; page += 1) {
          const result = await this.jingsai52.list(channel, page);
          if (!result.items.length) break;
          const enriched = result.items.map((item) => this.attachCatalog(item));
          const counts = this.store.upsertCompetitions(enriched);
          totals.added += counts.added;
          totals.updated += counts.updated;
          totals.unchanged += counts.unchanged;
          logger.info('52jingsai page synced', { channel: channel.key, page, items: result.items.length });
        }
      } catch (error) {
        const message = `${channel.key}: ${error instanceof Error ? error.message : String(error)}`;
        errors.push(message);
        logger.warn('52jingsai channel failed', { error: message });
      }
    }
    const errorMessage = errors.length ? errors.join('; ') : undefined;
    const nextLastSync = errorMessage && totals.added + totals.updated + totals.unchanged === 0
      ? state?.last_sync ?? null
      : nowIso();
    this.store.setSourceState('jingsai52', { last_sync: nextLastSync, last_error: errorMessage ?? null });
    this.store.setSourceState('jingsai52', { item_count: this.store.countBy('source').jingsai52 ?? 0 });
    return {
      source: 'jingsai52',
      added: totals.added,
      updated: totals.updated,
      unchanged: totals.unchanged,
      duration_ms: Date.now() - started,
      error: errorMessage
    };
  }

  listSources(): Array<Record<string, unknown>> {
    const states = new Map(this.store.getSourceStates().map((state) => [state.source, state]));
    const countBySource = this.store.countBy('source');
    return [
      {
        source: 'saikr',
        enabled: config.saikrEnabled,
        capabilities: ['search', 'list', 'detail'],
        rate_limit_ms: config.saikrMinIntervalMs,
        item_count: countBySource.saikr ?? 0,
        last_sync: states.get('saikr')?.last_sync ?? null,
        last_error: states.get('saikr')?.last_error ?? null,
        notes: '内部 JSON API，非公开开放接口；默认低频、可关闭'
      },
      {
        source: 'jingsai52',
        enabled: config.jingsai52Enabled,
        capabilities: ['list', 'detail'],
        rate_limit_ms: config.jingsai52MinIntervalMs,
        item_count: countBySource.jingsai52 ?? 0,
        last_sync: states.get('jingsai52')?.last_sync ?? null,
        last_error: states.get('jingsai52')?.last_error ?? null,
        notes: 'GBK HTML；按频道抓取，不提供站内搜索'
      },
      {
        source: 'catalog',
        enabled: true,
        capabilities: ['catalog'],
        item_count: this.store.catalogCount(),
        last_sync: states.get('catalog')?.last_sync ?? null,
        last_error: states.get('catalog')?.last_error ?? null,
        notes: '官方 84 项核心赛事目录，年度更新'
      }
    ];
  }

  stats(): StatsResult {
    return this.store.stats((competition) => statusOf(competition));
  }

  close(): void {
    this.store.close();
  }
}
