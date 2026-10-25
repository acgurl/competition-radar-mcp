import { createHash } from 'node:crypto';
import { load } from 'cheerio';
import type {
  CatalogItem,
  Category,
  Competition,
  CompetitionFormat,
  ExtractedClues,
  Level,
  Status
} from './types.js';

const CST = '+08:00';
const pad = (n: number) => String(n).padStart(2, '0');

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      const code = Number.parseInt(entity.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    if (entity.startsWith('#')) {
      const code = Number.parseInt(entity.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return ENTITIES[entity.toLowerCase()] ?? match;
  });
}

export function normalizeTitle(title: string): string {
  let s = decodeEntities(title).normalize('NFKC');
  s = s.replace(/<[^>]+>/g, ' ');
  s = s.replace(/^[\s[【(（<《]+[^\]】)）>》]{1,32}[\s\]】)）>》]+/, '');
  s = s.replace(/^(?:关于)?(?:举办|开展|组织参加|组织|启动)/, '');
  s = s.replace(/^关于/, '');
  s = s.replace(/20\d{2}\s*[-—–~至]\s*20\d{2}\s*年?/g, '');
  s = s.replace(/20\d{2}\s*年?/g, '');
  s = s.replace(/第[一二三四五六七八九十百零〇\d]+届/g, '');
  s = s.replace(
    /(预通知|报名通知|参赛通知|大赛通知|通知|正式启动|启动报名|报名开启|火热报名中|报名进行中|重磅来袭|来袭|最新|更新|NEW)/gi,
    ''
  );
  s = s.replace(/[“”"'‘’]/g, '');
  s = s.replace(/[\s\-—–_·、，,。.!！?？:：;；/\\|（）()【】[\]《》<>]/g, '');
  s = s.replace(/的$/, '');
  return s.toLowerCase();
}

export function canonicalKey(title: string): string {
  return createHash('sha1').update(normalizeTitle(title)).digest('hex').slice(0, 20);
}

export function monthListFromText(text: string): number[] {
  const months = new Set<number>();
  const range = /(\d{1,2})\s*月\s*[-—–~至到]\s*(\d{1,2})\s*月/g;
  let match: RegExpExecArray | null;
  while ((match = range.exec(text))) {
    const start = Number(match[1]);
    const end = Number(match[2]);
    if (start >= 1 && end <= 12 && start <= end) {
      for (let m = start; m <= end; m += 1) months.add(m);
    }
  }
  const single = /(\d{1,2})\s*月/g;
  while ((match = single.exec(text))) {
    const m = Number(match[1]);
    if (m >= 1 && m <= 12) months.add(m);
  }
  return [...months].sort((a, b) => a - b);
}

function partsFromDate(date: Date): [number, number, number, number, number, number] {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(
    fmt
      .formatToParts(date)
      .filter((p) => p.type !== 'literal')
      .map((p) => [p.type, Number(p.value)])
  ) as Record<string, number>;
  return [parts.year, parts.month, parts.day, parts.hour, parts.minute, parts.second];
}

export function isoFromCstParts(
  y: number,
  m: number,
  d: number,
  h = 0,
  mi = 0,
  s = 0
): string {
  return `${y}-${pad(m)}-${pad(d)}T${pad(h)}:${pad(mi)}:${pad(s)}${CST}`;
}

export function nowIso(date = new Date()): string {
  const [y, m, d, h, mi, s] = partsFromDate(date);
  return isoFromCstParts(y, m, d, h, mi, s);
}

export function formatCst(date: Date): string {
  return nowIso(date);
}

export function parseDateToIso(
  input: string | number | null | undefined,
  options: { endOfDay?: boolean } = {}
): string | null {
  if (input === null || input === undefined || input === '') return null;
  if (typeof input === 'number' || /^\d{10,13}$/.test(String(input).trim())) {
    const raw = Number(input);
    const ms = String(Math.trunc(raw)).length <= 10 ? raw * 1000 : raw;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : formatCst(date);
  }
  const s = String(input).trim();
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) {
    const date = new Date(s);
    return Number.isNaN(date.getTime()) ? null : formatCst(date);
  }
  const match = s.match(
    /(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*[:：分]\s*(\d{1,2}))?)?/
  );
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const hasTime = match[4] !== undefined;
  const h = hasTime ? Number(match[4]) : options.endOfDay ? 23 : 0;
  const mi = hasTime ? Number(match[5]) : options.endOfDay ? 59 : 0;
  const sec = hasTime ? Number(match[6] ?? 0) : options.endOfDay ? 59 : 0;
  return isoFromCstParts(y, m, d, h, mi, sec);
}

export function parseDates(text: string): string[] {
  const out: string[] = [];
  const re =
    /(\d{4})\s*[\/\-年.]\s*(\d{1,2})\s*[\/\-月.]\s*(\d{1,2})\s*日?(?:\s*(\d{1,2})\s*[:：时]\s*(\d{1,2})(?:\s*[:：分]\s*(\d{1,2}))?)?/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text))) {
    const iso = parseDateToIso(match[0]);
    if (iso) out.push(iso);
  }
  return out;
}

export function toMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

export function computeStatus(c: Pick<Competition, 'registration_start' | 'registration_end' | 'event_start' | 'event_end'>, now = Date.now()): Status {
  const regStart = toMs(c.registration_start);
  const regEnd = toMs(c.registration_end);
  const eventStart = toMs(c.event_start);
  const eventEnd = toMs(c.event_end);

  if (regStart === null && regEnd === null && eventStart === null && eventEnd === null) {
    return 'unknown';
  }
  if (regStart !== null && now < regStart) return 'upcoming';
  if (regEnd !== null && now <= regEnd) return 'registering';
  if (regEnd !== null && now > regEnd) {
    if (eventEnd !== null && now > eventEnd) return 'ended';
    if (eventStart !== null && now >= eventStart) return 'ongoing';
    return 'registration_closed';
  }
  if (eventEnd !== null && now > eventEnd) return 'ended';
  if (eventStart !== null && now >= eventStart) return 'ongoing';
  if (eventStart !== null && now < eventStart) return 'upcoming';
  if (regStart !== null) return 'registering';
  return 'unknown';
}

export function daysUntil(iso: string | null, now = Date.now()): number | null {
  const ms = toMs(iso);
  if (ms === null) return null;
  const [ey, em, ed] = partsFromDate(new Date(ms));
  const [ny, nm, nd] = partsFromDate(new Date(now));
  const endKey = Date.UTC(ey, em - 1, ed);
  const nowKey = Date.UTC(ny, nm - 1, nd);
  return Math.round((endKey - nowKey) / 86_400_000);
}

export function mapSaikrLevel(label?: string | null, numeric?: number | null): Level {
  const s = label ?? '';
  if (/全球|国际/.test(s)) return 'global';
  if (/全国|国家/.test(s)) return 'national';
  if (/省/.test(s)) return 'province';
  if (/市/.test(s)) return 'city';
  if (/校/.test(s)) return 'school';
  if (/自由/.test(s)) return 'free';
  if (/其他/.test(s)) return 'other';
  switch (numeric) {
    case 1:
      return 'school';
    case 2:
      return 'city';
    case 3:
      return 'province';
    case 4:
      return 'national';
    case 5:
      return 'global';
    case 6:
      return 'free';
    case 7:
      return 'other';
    default:
      return 'unknown';
  }
}

const SAIKR_CATEGORIES: Record<number, Category> = {
  1: 'math',
  2: 'computer',
  3: 'business',
  4: 'engineering',
  5: 'engineering',
  6: 'computer',
  7: 'comprehensive',
  8: 'business',
  9: 'engineering',
  10: 'engineering',
  11: 'engineering',
  12: 'engineering',
  13: 'engineering',
  14: 'engineering',
  15: 'science',
  16: 'math',
  17: 'science',
  18: 'science',
  19: 'language',
  20: 'design',
  21: 'design',
  22: 'design',
  23: 'other',
  24: 'humanities',
  25: 'design',
  26: 'business',
  27: 'comprehensive',
  28: 'other',
  29: 'comprehensive',
  30: 'science',
  31: 'other',
  32: 'sports',
  33: 'comprehensive',
  34: 'computer',
  35: 'science',
  36: 'humanities',
  1006: 'ai'
};

export function mapSaikrCategory(id?: number | null): Category {
  if (id === null || id === undefined) return 'unknown';
  return SAIKR_CATEGORIES[id] ?? 'unknown';
}

export function inferCategoryFromText(text: string): Category {
  const rules: Array<[Category, RegExp]> = [
    ['ai', /人工智能|机器学习|深度学习|大模型|智能算法/],
    ['computer', /计算机|软件|程序设计|信息安全|网络安全|芯片|集成电路|嵌入式|通信|大数据|算法|智能汽车|互联网/],
    ['business', /创新创业|创业|商业|营销|金融|经济|管理|电商|物流|会计|税收|沙盘|市场调查|创新大赛/],
    ['math', /数学建模|数学竞赛|统计建模|统计竞赛|统计学/],
    ['science', /物理|化学|力学|生命科学|医学|药学|健康|生物|地质|测绘|光电/],
    [
      'engineering',
      /机械|结构|建筑|土木|工程|机器人|电子|自动化|材料|化工|交通|车辆|航空|航天|船舶|海洋|能源|环境|水利|工业|金相/
    ],
    ['design', /设计|艺术|广告|摄影|视觉|动画|数字媒体/],
    ['language', /英语|外语|翻译|演讲|口译|写作|诵读|经典|跨文化/],
    ['sports', /体育|武术|舞蹈|音乐|歌唱/]
  ];
  for (const [category, re] of rules) {
    if (re.test(text)) return category;
  }
  return 'unknown';
}

export function inferLevelFromText(text: string): Level {
  if (/国际|全球|世界/.test(text)) return 'global';
  if (/全国|国家级|国赛|榜单/.test(text)) return 'national';
  if (/省级|省赛/.test(text)) return 'province';
  if (/市级|市赛/.test(text)) return 'city';
  if (/校级|校赛/.test(text)) return 'school';
  return 'unknown';
}

export function inferFormat(text: string): CompetitionFormat {
  const online = /线上|线上答题|网络赛|线上提交|线上评审/.test(text);
  const offline = /线下|现场赛|现场答辩|现场评审/.test(text);
  if (online && offline) return 'hybrid';
  if (online) return 'online';
  if (offline) return 'offline';
  return 'unknown';
}

export function buildSummary(parts: Array<string | null | undefined>, max = 220): string | null {
  const values = [...new Set(parts.map((p) => p?.trim()).filter((p): p is string => Boolean(p)))];
  if (!values.length) return null;
  const text = values.join(' · ');
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function bigrams(value: string): Set<string> {
  if (value.length < 2) return new Set([value]);
  const out = new Set<string>();
  for (let i = 0; i < value.length - 1; i += 1) out.add(value.slice(i, i + 2));
  return out;
}

export function diceSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  if (!a || !b) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let overlap = 0;
  for (const gram of A) if (B.has(gram)) overlap += 1;
  return (2 * overlap) / (A.size + B.size);
}

export interface CatalogMatch {
  item: CatalogItem;
  score: number;
}

export function matchCatalog(title: string, catalog: CatalogItem[]): CatalogMatch | null {
  const normalized = normalizeTitle(title);
  if (!normalized) return null;
  let best: CatalogMatch | null = null;
  for (const item of catalog) {
    const candidates = [item.name, ...item.aliases].map(normalizeTitle).filter(Boolean);
    for (const candidate of candidates) {
      let score = 0;
      if (candidate === normalized) score = 1;
      else if (
        candidate.length >= 6 &&
        normalized.length >= 6 &&
        (candidate.includes(normalized) || normalized.includes(candidate))
      ) {
        score = 0.93;
      } else {
        score = diceSimilarity(candidate, normalized);
      }
      if (!best || score > best.score) best = { item, score };
    }
  }
  return best && best.score >= 0.86 ? best : null;
}

export function htmlToText(html: string): string {
  const $ = load(html);
  $('script,style,noscript,svg,iframe').remove();
  $('br').replaceWith('\n');
  $('p,div,li,tr,h1,h2,h3,h4,h5,section,article,table').each((_, el) => {
    $(el).append('\n');
  });
  return $.root()
    .text()
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function extractLinks(html: string, baseUrl: string): Array<{ url: string; text: string }> {
  const $ = load(html);
  const out: Array<{ url: string; text: string }> = [];
  const seen = new Set<string>();
  $('a[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || /^(javascript:|mailto:|tel:|#)/i.test(href)) return;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    if (!/^https?:\/\//i.test(url) || seen.has(url)) return;
    seen.add(url);
    out.push({ url, text: $(el).text().replace(/\s+/g, ' ').trim() });
  });
  return out;
}

function firstMatch(text: string, patterns: RegExp[]): string | null {
  for (const re of patterns) {
    const match = text.match(re);
    if (match?.[0]) return match[0].replace(/\s+/g, ' ').trim();
  }
  return null;
}

function extractFeeText(text: string): string | null {
  const withAmount =
    /(?:报名费|参赛费|会务费|评审费)[^\n。；;]{0,80}?(?:\d+(?:\.\d+)?\s*元|免费|不收取|免收)[^\n。；;]{0,60}/g;
  const matches = [...text.matchAll(withAmount)].map((match) => match[0].replace(/\s+/g, ' ').trim());
  if (matches.length) {
    matches.sort((a, b) => {
      const score = (value: string) =>
        (/报名费/.test(value) ? 3 : 0) +
        (/\d+(?:\.\d+)?\s*元/.test(value) ? 2 : 0) +
        (/\/人|每人/.test(value) ? 1 : 0);
      return score(b) - score(a);
    });
    return matches[0].slice(0, 160);
  }
  return firstMatch(text, [
    /(?:不收取|免收)(?:报名费|参赛费|费用)[^\n。；;]{0,60}/,
    /(?:免费参赛|参赛免费|报名免费)[^\n。；;]{0,60}/
  ]);
}

function endOfDayIfMidnight(iso: string | null): string | null {
  return iso?.endsWith('T00:00:00+08:00')
    ? iso.replace('T00:00:00+08:00', 'T23:59:59+08:00')
    : iso;
}

export function extractClues(
  text: string,
  links: Array<{ url: string; text: string }> = []
): ExtractedClues {
  const officialLink =
    links.find((link) => /官网|官方网站|大赛官网|报名网址|赛事官网/.test(link.text)) ??
    links.find((link) => !/saikr\.com|52jingsai\.com/.test(link.url)) ??
    null;

  return {
    registration_text: firstMatch(text, [
      /报名(?:时间|日期|截止日期|截止时间)?[：:]\s*[^\n。；;]{2,100}/,
      /(?:即日起|自即日起)至[^\n。；;]{2,60}/,
      /报名截止[^\n。；;]{0,80}/
    ]),
    event_text: firstMatch(text, [
      /(?:比赛|参赛|竞赛|决赛|初赛|复赛)(?:时间|日期)[：:]\s*[^\n。；;]{2,100}/,
      /(?:比赛|参赛|竞赛)时间[^\n。；;]{0,80}/
    ]),
    fee_text: extractFeeText(text),
    format_text: firstMatch(text, [
      /(?:线上|线下|线上答题|网络赛|现场赛|线上提交|线上评审|现场答辩)[^\n。；;]{0,50}/
    ]),
    organizer_text: firstMatch(text, [
      /主办(?:单位|方)[：:]\s*[^\n。；;]{2,100}/,
      /承办(?:单位|方)[：:]\s*[^\n。；;]{2,100}/
    ]),
    official_url: officialLink?.url ?? null
  };
}

export interface DateRange {
  registration_start: string | null;
  registration_end: string | null;
  event_start: string | null;
  event_end: string | null;
}

export function extractDatesFromText(text: string): DateRange {
  const out: DateRange = {
    registration_start: null,
    registration_end: null,
    event_start: null,
    event_end: null
  };

  const regSegment = firstMatch(text, [
    /报名(?:时间|日期)?[：:]?\s*[^\n。；;]{2,120}/,
    /(?:即日起|自即日起)[^\n。；;]{0,100}/
  ]);
  if (regSegment) {
    const dates = parseDates(regSegment);
    if (dates.length >= 2) {
      out.registration_start = dates[0];
      out.registration_end = endOfDayIfMidnight(dates[dates.length - 1]);
    } else if (dates.length === 1) {
      out.registration_end = endOfDayIfMidnight(dates[0]);
    }
  }

  const cutoff = firstMatch(text, [/报名截止(?:时间|日期)?[：:]?\s*[^\n。；;]{0,100}/]);
  if (cutoff) {
    const dates = parseDates(cutoff);
    if (dates.length) out.registration_end = endOfDayIfMidnight(dates[0]);
  }

  const eventSegment = firstMatch(text, [
    /(?:比赛|参赛|竞赛|决赛|初赛|复赛)(?:时间|日期)[：:]?\s*[^\n。；;]{2,120}/
  ]);
  if (eventSegment) {
    const dates = parseDates(eventSegment);
    if (dates.length >= 2) {
      out.event_start = dates[0];
      out.event_end = endOfDayIfMidnight(dates[dates.length - 1]);
    } else if (dates.length === 1) {
      out.event_start = dates[0];
    }
  }

  return out;
}

export function normalizeOrganizer(value: unknown): string[] {
  if (Array.isArray(value)) {
    return [...new Set(value.map((v) => String(v).trim()).filter(Boolean))];
  }
  if (typeof value === 'string') {
    return [
      ...new Set(
        value
          .split(/[、,，;；]/)
          .map((v) => v.trim())
          .filter(Boolean)
      )
    ];
  }
  return [];
}
