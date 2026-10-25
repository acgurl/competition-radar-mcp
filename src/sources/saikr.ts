import { config } from '../config.js';
import {
  buildSummary,
  canonicalKey,
  extractClues,
  extractDatesFromText,
  extractLinks,
  htmlToText,
  inferCategoryFromText,
  inferFormat,
  mapSaikrCategory,
  mapSaikrLevel,
  normalizeOrganizer,
  nowIso,
  parseDateToIso
} from '../normalize.js';
import type { Competition, ExtractedClues, Level } from '../types.js';
import { fetchJson, HttpError } from './fetch.js';

const API_BASE = 'https://apiv4buffer.saikr.com';
const WEB_BASE = 'https://www.saikr.com';

interface SaikrListItem {
  contest_id: number;
  contest_name: string;
  contest_url: string;
  is_exam?: number;
  is_contest_status?: number;
  regist_start_time?: number;
  regist_end_time?: number;
  contest_start_time?: number;
  contest_end_time?: number;
  level_name?: string;
  organiser?: string;
  enter_range?: string;
  contest_class_first?: number;
  contest_class_second?: string;
  contest_class_second_id?: number;
  time_status?: number;
  time_name?: string;
  labels?: string[];
  thumb_pic?: string;
  rank?: number;
  is_new?: number;
}

interface SaikrListPayload {
  code: number;
  msg: string;
  data: {
    total: number;
    total_page?: number;
    list: SaikrListItem[];
  };
}

interface SaikrDetailPayload {
  code: number;
  msg: string;
  data: SaikrDetail | SaikrDetail[];
}

export interface SaikrDetail {
  contest_id: number;
  contest_name: string;
  organiser?: string[] | string;
  org_real_name?: string;
  regist_start_time?: string;
  regist_end_time?: string;
  contest_start_time?: string;
  contest_end_time?: string;
  participation_explain?: string;
  participation_detail?: { explain?: string; detail?: string };
  contest_class_first?: number;
  contest_class_second?: string;
  contest_class_second_id?: number;
  contest_level?: number;
  content?: string;
  is_redirect_external?: number;
  external_link?: string;
  focus_num?: number;
  look_count?: number;
  contest_url?: string;
}

export interface SaikrListOptions {
  page?: number;
  limit?: number;
  classId?: number;
  level?: number;
  sort?: number;
}

export interface SaikrDetailResult {
  competition: Competition;
  content: string;
  links: string[];
  extracted: ExtractedClues;
}

const LEVEL_TO_SAIKR: Record<Level, number | undefined> = {
  school: 1,
  city: 2,
  province: 3,
  national: 4,
  global: 5,
  free: 6,
  other: 7,
  unknown: undefined
};

export function saikrLevelParam(level?: Level): number | undefined {
  return level ? LEVEL_TO_SAIKR[level] : undefined;
}

function webUrl(contestUrl: string): string {
  const path = contestUrl.startsWith('/') ? contestUrl.slice(1) : contestUrl;
  return `${WEB_BASE}/${path}`;
}

function splitOrganizer(value?: string): string[] {
  if (!value) return [];
  return [
    ...new Set(
      value
        .split(/[、,，;；]/)
        .map((part) => part.trim())
        .filter(Boolean)
    )
  ];
}

export function mapSaikrListItem(item: SaikrListItem, now = new Date()): Competition {
  const timestamp = nowIso(now);
  const title = item.contest_name.trim();
  const regEnd = parseDateToIso(item.regist_end_time ?? null);
  const organizer = splitOrganizer(item.organiser);
  const tags = item.labels ?? [];
  const fromClass = mapSaikrCategory(item.contest_class_second_id);
  const fromTitle = inferCategoryFromText(title);
  const category =
    fromTitle !== 'unknown' && (fromClass === 'unknown' || fromClass === 'computer')
      ? fromTitle
      : fromClass;
  const level = mapSaikrLevel(item.level_name);
  const summary = buildSummary([
    organizer[0],
    item.level_name,
    regEnd ? `报名至 ${regEnd.slice(0, 10)}` : null,
    ...tags.slice(0, 2)
  ]);

  return {
    id: `saikr:${item.contest_id}`,
    source: 'saikr',
    source_id: String(item.contest_id),
    title,
    url: webUrl(item.contest_url),
    summary,
    cover_url: item.thumb_pic ?? null,
    organizer,
    level,
    level_label: item.level_name ?? null,
    category,
    category_label: item.contest_class_second ?? null,
    tags,
    registration_start: parseDateToIso(item.regist_start_time ?? null),
    registration_end: regEnd,
    event_start: parseDateToIso(item.contest_start_time ?? null),
    event_end: parseDateToIso(item.contest_end_time ?? null),
    fee: null,
    eligibility: item.enter_range ?? null,
    format: inferFormat(`${title} ${tags.join(' ')}`),
    official: false,
    catalog_id: null,
    catalog_url: null,
    canonical_key: canonicalKey(title),
    fetched_at: timestamp,
    updated_at: timestamp
  };
}

export function parseSaikrDetail(detail: SaikrDetail, now = new Date()): SaikrDetailResult {
  const timestamp = nowIso(now);
  const title = detail.contest_name.trim();
  const contentHtml = detail.content ?? '';
  const content = htmlToText(contentHtml);
  const links = extractLinks(contentHtml, `${WEB_BASE}/`);
  const clues = extractClues(content, links);
  const dateHints = extractDatesFromText(content);
  const organizer = normalizeOrganizer(detail.organiser ?? detail.org_real_name ?? '');
  const eligibility =
    detail.participation_detail?.explain ??
    detail.participation_detail?.detail ??
    detail.participation_explain ??
    null;
  const category = mapSaikrCategory(detail.contest_class_second_id ?? detail.contest_class_first);
  const level = mapSaikrLevel(undefined, detail.contest_level ?? null);
  const officialFromExternal =
    detail.is_redirect_external === 1 && detail.external_link ? detail.external_link : null;

  const competition: Competition = {
    id: `saikr:${detail.contest_id}`,
    source: 'saikr',
    source_id: String(detail.contest_id),
    title,
    url: detail.contest_url ? webUrl(detail.contest_url) : `${WEB_BASE}/vse/${detail.contest_id}`,
    summary: buildSummary([
      organizer[0],
      eligibility,
      clues.registration_text,
      clues.fee_text
    ]),
    cover_url: null,
    organizer,
    level,
    level_label: null,
    category,
    category_label: detail.contest_class_second ?? null,
    tags: [],
    registration_start:
      parseDateToIso(detail.regist_start_time ?? null) ?? dateHints.registration_start,
    registration_end:
      parseDateToIso(detail.regist_end_time ?? null) ?? dateHints.registration_end,
    event_start: parseDateToIso(detail.contest_start_time ?? null) ?? dateHints.event_start,
    event_end: parseDateToIso(detail.contest_end_time ?? null) ?? dateHints.event_end,
    fee: clues.fee_text,
    eligibility,
    format: inferFormat(`${title} ${content.slice(0, 500)}`),
    official: false,
    catalog_id: null,
    catalog_url: null,
    canonical_key: canonicalKey(title),
    fetched_at: timestamp,
    updated_at: timestamp
  };

  if (officialFromExternal && !clues.official_url) clues.official_url = officialFromExternal;

  return {
    competition,
    content,
    links: links.map((link) => link.url),
    extracted: clues
  };
}

export class SaikrAdapter {
  constructor(
    private readonly options: {
      enabled: boolean;
      minIntervalMs: number;
    } = { enabled: config.saikrEnabled, minIntervalMs: config.saikrMinIntervalMs }
  ) {}

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new HttpError('SOURCE_DISABLED', 'saikr adapter is disabled', null, false);
    }
  }

  private headers(referer: string): Record<string, string> {
    return {
      Referer: referer,
      Origin: WEB_BASE
    };
  }

  async list(options: SaikrListOptions = {}): Promise<{ items: Competition[]; total: number }> {
    this.assertEnabled();
    const params = new URLSearchParams();
    params.set('page', String(Math.max(1, options.page ?? 1)));
    params.set('limit', String(Math.min(100, Math.max(1, options.limit ?? 100))));
    params.set('sort', String(options.sort ?? 0));
    if (options.classId !== undefined) params.set('class_id', String(options.classId));
    if (options.level !== undefined) params.set('level', String(options.level));
    else if (options.level === undefined) params.set('level', '0');

    const payload = await fetchJson<SaikrListPayload>(
      `${API_BASE}/api/pc/contest/lists?${params.toString()}`,
      {
        headers: this.headers(`${WEB_BASE}/contests`),
        minIntervalMs: this.options.minIntervalMs
      }
    );
    if (payload.code !== 200 || !payload.data) {
      throw new HttpError('SAIKR_API_ERROR', payload.msg || 'saikr list failed', 200, false);
    }
    return {
      items: (payload.data.list ?? []).map((item) => mapSaikrListItem(item)),
      total: payload.data.total ?? 0
    };
  }

  async search(keyword: string, limit = 50): Promise<{ items: Competition[]; total: number }> {
    this.assertEnabled();
    const trimmed = keyword.trim();
    if (!trimmed) return { items: [], total: 0 };
    const params = new URLSearchParams({
      keyword: trimmed,
      type: '0',
      page: '1',
      limit: String(Math.min(50, Math.max(1, limit)))
    });
    const payload = await fetchJson<SaikrListPayload>(
      `${API_BASE}/api/pc/search/info?${params.toString()}`,
      {
        headers: this.headers(`${WEB_BASE}/search`),
        minIntervalMs: this.options.minIntervalMs
      }
    );
    if (payload.code !== 200 || !payload.data) {
      throw new HttpError('SAIKR_API_ERROR', payload.msg || 'saikr search failed', 200, false);
    }
    return {
      items: (payload.data.list ?? []).map((item) => mapSaikrListItem(item)),
      total: payload.data.total ?? 0
    };
  }

  async detail(contestId: string | number): Promise<SaikrDetailResult> {
    this.assertEnabled();
    const params = new URLSearchParams({ contest_id: String(contestId) });
    const payload = await fetchJson<SaikrDetailPayload>(
      `${API_BASE}/api/pc/contest/info?${params.toString()}`,
      {
        headers: this.headers(`${WEB_BASE}/`),
        minIntervalMs: this.options.minIntervalMs
      }
    );
    if (payload.code !== 200 || !payload.data || Array.isArray(payload.data)) {
      throw new HttpError('SAIKR_NOT_FOUND', payload.msg || 'saikr detail failed', 200, false);
    }
    return parseSaikrDetail(payload.data);
  }
}

export { mapSaikrListItem as __mapSaikrListItem };
