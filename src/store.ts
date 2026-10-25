import { mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config.js';
import { matchCatalog, nowIso } from './normalize.js';
import type {
  CatalogItem,
  Category,
  Competition,
  CompetitionFormat,
  ExtractedClues,
  Level,
  SourceId,
  SourceState,
  StatsResult
} from './types.js';

type DB = Database.Database;

interface CompetitionRow {
  id: string;
  source: string;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  cover_url: string | null;
  organizer: string | null;
  level: string;
  level_label: string | null;
  category: string;
  category_label: string | null;
  tags: string | null;
  registration_start: string | null;
  registration_end: string | null;
  event_start: string | null;
  event_end: string | null;
  fee: string | null;
  eligibility: string | null;
  format: string;
  official: number;
  catalog_id: string | null;
  catalog_url: string | null;
  canonical_key: string;
  fetched_at: string;
  updated_at: string;
}

interface CatalogRow {
  id: string;
  no: number | null;
  name: string;
  aliases: string | null;
  url: string | null;
  category: string;
  typical_months: string | null;
  note: string | null;
  version: string | null;
}

export interface DetailRecord {
  content: string;
  links: string[];
  extracted: ExtractedClues | null;
  fetched_at: string;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS competitions (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_id TEXT NOT NULL,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  summary TEXT,
  cover_url TEXT,
  organizer TEXT,
  level TEXT NOT NULL DEFAULT 'unknown',
  level_label TEXT,
  category TEXT NOT NULL DEFAULT 'unknown',
  category_label TEXT,
  tags TEXT,
  registration_start TEXT,
  registration_end TEXT,
  event_start TEXT,
  event_end TEXT,
  fee TEXT,
  eligibility TEXT,
  format TEXT NOT NULL DEFAULT 'unknown',
  official INTEGER NOT NULL DEFAULT 0,
  catalog_id TEXT,
  catalog_url TEXT,
  canonical_key TEXT NOT NULL,
  raw TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(source, source_id)
);
CREATE INDEX IF NOT EXISTS idx_comp_end ON competitions(registration_end, event_start, event_end);
CREATE INDEX IF NOT EXISTS idx_comp_category ON competitions(category);
CREATE INDEX IF NOT EXISTS idx_comp_level ON competitions(level);
CREATE INDEX IF NOT EXISTS idx_comp_canonical ON competitions(canonical_key);
CREATE INDEX IF NOT EXISTS idx_comp_official ON competitions(official);

CREATE TABLE IF NOT EXISTS details (
  id TEXT PRIMARY KEY REFERENCES competitions(id) ON DELETE CASCADE,
  content TEXT,
  links TEXT,
  extracted TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS catalog (
  id TEXT PRIMARY KEY,
  no INTEGER,
  name TEXT NOT NULL,
  aliases TEXT,
  url TEXT,
  category TEXT NOT NULL DEFAULT 'unknown',
  typical_months TEXT,
  note TEXT,
  version TEXT
);

CREATE TABLE IF NOT EXISTS source_state (
  source TEXT PRIMARY KEY,
  last_sync TEXT,
  last_error TEXT,
  item_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

function parseJsonArray(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function rowToCompetition(row: CompetitionRow): Competition {
  return {
    id: row.id,
    source: row.source as SourceId,
    source_id: row.source_id,
    title: row.title,
    url: row.url,
    summary: row.summary,
    cover_url: row.cover_url,
    organizer: parseJsonArray(row.organizer),
    level: row.level as Level,
    level_label: row.level_label,
    category: row.category as Category,
    category_label: row.category_label,
    tags: parseJsonArray(row.tags),
    registration_start: row.registration_start,
    registration_end: row.registration_end,
    event_start: row.event_start,
    event_end: row.event_end,
    fee: row.fee,
    eligibility: row.eligibility,
    format: row.format as CompetitionFormat,
    official: row.official === 1,
    catalog_id: row.catalog_id,
    catalog_url: row.catalog_url,
    canonical_key: row.canonical_key,
    fetched_at: row.fetched_at,
    updated_at: row.updated_at
  };
}

function rowToCatalog(row: CatalogRow): CatalogItem {
  return {
    id: row.id,
    no: row.no,
    name: row.name,
    aliases: parseJsonArray(row.aliases),
    url: row.url,
    category: row.category as Category,
    typical_months: parseJsonArray(row.typical_months).map(Number),
    note: row.note,
    version: row.version ?? undefined
  };
}

function isFallbackSaikrUrl(url: string): boolean {
  return /^https:\/\/www\.saikr\.com\/vse\/\d+$/.test(url);
}

export function mergeCompetition(existing: Competition, incoming: Competition): Competition {
  const incomingUrl =
    existing.url && isFallbackSaikrUrl(incoming.url) ? existing.url : incoming.url || existing.url;
  return {
    ...existing,
    title: incoming.title || existing.title,
    url: incomingUrl,
    summary: incoming.summary ?? existing.summary,
    cover_url: incoming.cover_url ?? existing.cover_url,
    organizer: incoming.organizer.length ? incoming.organizer : existing.organizer,
    level: incoming.level !== 'unknown' ? incoming.level : existing.level,
    level_label: incoming.level_label ?? existing.level_label,
    category: incoming.category !== 'unknown' ? incoming.category : existing.category,
    category_label: incoming.category_label ?? existing.category_label,
    tags: incoming.tags.length ? incoming.tags : existing.tags,
    registration_start: incoming.registration_start ?? existing.registration_start,
    registration_end: incoming.registration_end ?? existing.registration_end,
    event_start: incoming.event_start ?? existing.event_start,
    event_end: incoming.event_end ?? existing.event_end,
    fee: incoming.fee ?? existing.fee,
    eligibility: incoming.eligibility ?? existing.eligibility,
    format: incoming.format !== 'unknown' ? incoming.format : existing.format,
    official: existing.official || incoming.official,
    catalog_id: existing.catalog_id ?? incoming.catalog_id,
    catalog_url: existing.catalog_url ?? incoming.catalog_url,
    canonical_key: incoming.title ? incoming.canonical_key : existing.canonical_key,
    fetched_at: incoming.fetched_at,
    updated_at: existing.updated_at
  };
}

function comparable(c: Competition): string {
  return JSON.stringify({
    ...c,
    fetched_at: '',
    updated_at: ''
  });
}

export class Store {
  readonly db: DB;

  constructor(dbPath = config.dbPath) {
    mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this.db.exec(SCHEMA);
  }

  close(): void {
    this.db.close();
  }

  getCompetition(id: string): Competition | null {
    const row = this.db.prepare('SELECT * FROM competitions WHERE id = ?').get(id) as
      | CompetitionRow
      | undefined;
    return row ? rowToCompetition(row) : null;
  }

  hasCompetition(id: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM competitions WHERE id = ?').get(id));
  }

  upsertCompetition(
    incoming: Competition,
    raw?: unknown
  ): 'added' | 'updated' | 'unchanged' {
    const existing = this.getCompetition(incoming.id);
    const merged = existing ? mergeCompetition(existing, incoming) : incoming;
    const changed = existing ? comparable(merged) !== comparable(existing) : false;
    if (!changed) {
      merged.updated_at = existing?.updated_at ?? incoming.updated_at;
    } else {
      merged.updated_at = incoming.updated_at;
    }

    this.db
      .prepare(
        `INSERT INTO competitions (
          id, source, source_id, title, url, summary, cover_url, organizer,
          level, level_label, category, category_label, tags,
          registration_start, registration_end, event_start, event_end,
          fee, eligibility, format, official, catalog_id, catalog_url,
          canonical_key, raw, fetched_at, updated_at
        ) VALUES (
          @id, @source, @source_id, @title, @url, @summary, @cover_url, @organizer,
          @level, @level_label, @category, @category_label, @tags,
          @registration_start, @registration_end, @event_start, @event_end,
          @fee, @eligibility, @format, @official, @catalog_id, @catalog_url,
          @canonical_key, @raw, @fetched_at, @updated_at
        )
        ON CONFLICT(id) DO UPDATE SET
          source = excluded.source,
          source_id = excluded.source_id,
          title = excluded.title,
          url = excluded.url,
          summary = excluded.summary,
          cover_url = excluded.cover_url,
          organizer = excluded.organizer,
          level = excluded.level,
          level_label = excluded.level_label,
          category = excluded.category,
          category_label = excluded.category_label,
          tags = excluded.tags,
          registration_start = excluded.registration_start,
          registration_end = excluded.registration_end,
          event_start = excluded.event_start,
          event_end = excluded.event_end,
          fee = excluded.fee,
          eligibility = excluded.eligibility,
          format = excluded.format,
          official = excluded.official,
          catalog_id = excluded.catalog_id,
          catalog_url = excluded.catalog_url,
          canonical_key = excluded.canonical_key,
          raw = COALESCE(excluded.raw, competitions.raw),
          fetched_at = excluded.fetched_at,
          updated_at = excluded.updated_at`
      )
      .run({
        ...merged,
        organizer: JSON.stringify(merged.organizer),
        tags: JSON.stringify(merged.tags),
        official: merged.official ? 1 : 0,
        raw: raw === undefined ? null : JSON.stringify(raw)
      });

    if (!existing) return 'added';
    return changed ? 'updated' : 'unchanged';
  }

  upsertCompetitions(items: Competition[]): { added: number; updated: number; unchanged: number } {
    const result = { added: 0, updated: 0, unchanged: 0 };
    const tx = this.db.transaction((list: Competition[]) => {
      for (const item of list) {
        const outcome = this.upsertCompetition(item);
        result[outcome] += 1;
      }
    });
    tx(items);
    return result;
  }

  searchCandidates(options: {
    query?: string;
    source?: SourceId;
    category?: Category;
    level?: Level;
    officialOnly?: boolean;
    limit?: number;
  }): Competition[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.source) {
      where.push('source = ?');
      params.push(options.source);
    }
    if (options.category) {
      where.push('category = ?');
      params.push(options.category);
    }
    if (options.level) {
      where.push('level = ?');
      params.push(options.level);
    }
    if (options.officialOnly) where.push('official = 1');

    const tokens = (options.query ?? '')
      .split(/\s+/)
      .map((token) => token.trim())
      .filter(Boolean)
      .slice(0, 8);
    for (const token of tokens) {
      const like = `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      where.push(
        "(title LIKE ? ESCAPE '\\' COLLATE NOCASE OR summary LIKE ? ESCAPE '\\' COLLATE NOCASE OR organizer LIKE ? ESCAPE '\\' COLLATE NOCASE OR tags LIKE ? ESCAPE '\\' COLLATE NOCASE)"
      );
      params.push(like, like, like, like);
    }

    const sql = `SELECT * FROM competitions ${
      where.length ? `WHERE ${where.join(' AND ')}` : ''
    } ORDER BY updated_at DESC LIMIT ?`;
    params.push(Math.min(5000, Math.max(1, options.limit ?? 3000)));
    const rows = this.db.prepare(sql).all(...params) as CompetitionRow[];
    return rows.map(rowToCompetition);
  }

  allCompetitions(): Competition[] {
    const rows = this.db.prepare('SELECT * FROM competitions').all() as CompetitionRow[];
    return rows.map(rowToCompetition);
  }

  countCompetitions(): number {
    const row = this.db.prepare('SELECT COUNT(*) AS n FROM competitions').get() as { n: number };
    return row.n;
  }

  countBy(column: 'source' | 'category'): Record<string, number> {
    const rows = this.db
      .prepare(`SELECT ${column} AS key, COUNT(*) AS n FROM competitions GROUP BY ${column}`)
      .all() as Array<{ key: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.key, row.n]));
  }

  saveDetail(id: string, detail: DetailRecord): void {
    this.db
      .prepare(
        `INSERT INTO details (id, content, links, extracted, fetched_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           content = excluded.content,
           links = excluded.links,
           extracted = excluded.extracted,
           fetched_at = excluded.fetched_at`
      )
      .run(
        id,
        detail.content,
        JSON.stringify(detail.links),
        detail.extracted ? JSON.stringify(detail.extracted) : null,
        detail.fetched_at
      );
  }

  getDetail(id: string): DetailRecord | null {
    const row = this.db
      .prepare('SELECT content, links, extracted, fetched_at FROM details WHERE id = ?')
      .get(id) as
      | { content: string | null; links: string | null; extracted: string | null; fetched_at: string }
      | undefined;
    if (!row) return null;
    let extracted: ExtractedClues | null = null;
    if (row.extracted) {
      try {
        extracted = JSON.parse(row.extracted) as ExtractedClues;
      } catch {
        extracted = null;
      }
    }
    return {
      content: row.content ?? '',
      links: parseJsonArray(row.links),
      extracted,
      fetched_at: row.fetched_at
    };
  }

  loadCatalog(items: CatalogItem[]): void {
    const tx = this.db.transaction((list: CatalogItem[]) => {
      this.db.prepare('DELETE FROM catalog').run();
      const stmt = this.db.prepare(
        `INSERT INTO catalog (id, no, name, aliases, url, category, typical_months, note, version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const item of list) {
        stmt.run(
          item.id,
          item.no,
          item.name,
          JSON.stringify(item.aliases),
          item.url,
          item.category,
          JSON.stringify(item.typical_months),
          item.note,
          item.version ?? null
        );
      }
    });
    tx(items);
  }

  allCatalog(): CatalogItem[] {
    const rows = this.db.prepare('SELECT * FROM catalog ORDER BY no IS NULL, no, name').all() as CatalogRow[];
    return rows.map(rowToCatalog);
  }

  getCatalogItem(id: string): CatalogItem | null {
    const row = this.db.prepare('SELECT * FROM catalog WHERE id = ?').get(id) as CatalogRow | undefined;
    return row ? rowToCatalog(row) : null;
  }

  queryCatalog(options: {
    query?: string;
    month?: number;
    category?: Category;
    limit?: number;
  }): CatalogItem[] {
    const where: string[] = [];
    const params: unknown[] = [];
    if (options.category) {
      where.push('category = ?');
      params.push(options.category);
    }
    for (const token of (options.query ?? '').split(/\s+/).filter(Boolean).slice(0, 6)) {
      const like = `%${token.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      where.push("(name LIKE ? ESCAPE '\\' COLLATE NOCASE OR aliases LIKE ? ESCAPE '\\' COLLATE NOCASE)");
      params.push(like, like);
    }
    const rows = this.db
      .prepare(
        `SELECT * FROM catalog ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY no IS NULL, no, name`
      )
      .all(...params) as CatalogRow[];
    const items = rows.map(rowToCatalog);
    const filtered = options.month ? items.filter((item) => item.typical_months.includes(options.month!)) : items;
    return filtered.slice(0, Math.min(200, Math.max(1, options.limit ?? 50)));
  }

  countCompetitionsByCatalog(): Record<string, number> {
    const rows = this.db
      .prepare(
        'SELECT catalog_id, COUNT(*) AS n FROM competitions WHERE catalog_id IS NOT NULL GROUP BY catalog_id'
      )
      .all() as Array<{ catalog_id: string; n: number }>;
    return Object.fromEntries(rows.map((row) => [row.catalog_id, row.n]));
  }

  applyCatalogMatches(catalog?: CatalogItem[]): { matched: number; changed: number } {
    const items = catalog ?? this.allCatalog();
    if (!items.length) return { matched: 0, changed: 0 };
    const rows = this.db.prepare('SELECT id, title, official, catalog_id, catalog_url FROM competitions').all() as Array<{
      id: string;
      title: string;
      official: number;
      catalog_id: string | null;
      catalog_url: string | null;
    }>;
    const update = this.db.prepare(
      'UPDATE competitions SET official = ?, catalog_id = ?, catalog_url = ? WHERE id = ?'
    );
    let matched = 0;
    let changed = 0;
    const tx = this.db.transaction(() => {
      for (const row of rows) {
        const hit = matchCatalog(row.title, items);
        const official = hit ? 1 : 0;
        const catalogId = hit?.item.id ?? null;
        const catalogUrl = hit?.item.url ?? null;
        if (hit) matched += 1;
        if (
          official !== row.official ||
          catalogId !== row.catalog_id ||
          catalogUrl !== row.catalog_url
        ) {
          update.run(official, catalogId, catalogUrl, row.id);
          changed += 1;
        }
      }
    });
    tx();
    return { matched, changed };
  }

  setSourceState(
    source: string,
    state: { last_sync?: string | null; last_error?: string | null; item_count?: number }
  ): void {
    const existing = this.getSourceState(source);
    const itemCount =
      state.item_count ??
      (this.db.prepare('SELECT COUNT(*) AS n FROM competitions WHERE source = ?').get(source) as {
        n: number;
      }).n;
    this.db
      .prepare(
        `INSERT INTO source_state (source, last_sync, last_error, item_count)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(source) DO UPDATE SET
           last_sync = excluded.last_sync,
           last_error = excluded.last_error,
           item_count = excluded.item_count`
      )
      .run(source, state.last_sync ?? existing?.last_sync ?? null, state.last_error ?? null, itemCount);
  }

  getSourceState(source: string): SourceState | null {
    return (
      (this.db.prepare('SELECT * FROM source_state WHERE source = ?').get(source) as
        | SourceState
        | undefined) ?? null
    );
  }

  getSourceStates(): SourceState[] {
    return this.db.prepare('SELECT * FROM source_state ORDER BY source').all() as SourceState[];
  }

  getMeta(key: string): string | null {
    const row = this.db.prepare('SELECT value FROM meta WHERE key = ?').get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
      .run(key, value);
  }

  catalogCount(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM catalog').get() as { n: number }).n;
  }

  stats(computeStatus: (c: Competition) => string): StatsResult {
    const competitions = this.allCompetitions();
    const byStatus: Record<string, number> = {};
    for (const competition of competitions) {
      const status = computeStatus(competition);
      byStatus[status] = (byStatus[status] ?? 0) + 1;
    }
    const states = this.getSourceStates();
    return {
      competitions: competitions.length,
      by_source: this.countBy('source'),
      by_status: byStatus,
      by_category: this.countBy('category'),
      official: competitions.filter((c) => c.official).length,
      catalog: this.catalogCount(),
      last_sync: Object.fromEntries(states.map((state) => [state.source, state.last_sync]))
    };
  }

  touchSource(source: string, error?: string): void {
    this.setSourceState(source, {
      last_sync: error ? this.getSourceState(source)?.last_sync ?? null : nowIso(),
      last_error: error ?? null
    });
  }
}
