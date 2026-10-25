import { load } from 'cheerio';
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
  inferLevelFromText,
  normalizeOrganizer,
  nowIso,
  parseDateToIso
} from '../normalize.js';
import type { Category, Competition, ExtractedClues } from '../types.js';
import { fetchText, HttpError } from './fetch.js';

const WEB_BASE = 'https://www.52jingsai.com';

export interface JingsaiChannel {
  key: string;
  label: string;
  url: string;
  category: Category;
}

export const JINGSAI_CHANNELS: JingsaiChannel[] = [
  { key: 'bangdan', label: '榜单竞赛', url: `${WEB_BASE}/bisai/xkjn/bangdan/`, category: 'comprehensive' },
  { key: 'keji', label: '科技大赛', url: `${WEB_BASE}/bisai/keji/keji/`, category: 'engineering' },
  { key: 'kfyy', label: 'IT应用开发', url: `${WEB_BASE}/bisai/keji/kfyy/`, category: 'computer' },
  { key: 'xkxs', label: '学科学术', url: `${WEB_BASE}/bisai/xkjn/xkxs/`, category: 'science' },
  { key: 'chuangye', label: '创业大赛', url: `${WEB_BASE}/bisai/shangyechuangye/chuangye/`, category: 'business' },
  { key: 'yingyu', label: '英语竞赛', url: `${WEB_BASE}/bisai/yingyujingsai/`, category: 'language' },
  { key: 'sheji', label: '设计比赛', url: `${WEB_BASE}/bisai/keji/sheji/`, category: 'design' },
  { key: 'guanggao', label: '广告创意', url: `${WEB_BASE}/bisai/gggy/guanggao/`, category: 'design' }
];

export const DEFAULT_JINGSAI_CHANNELS = JINGSAI_CHANNELS.slice(0, 6);

function absoluteUrl(href: string, base = WEB_BASE): string {
  if (href.startsWith('//')) return `https:${href}`;
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function cleanText(value: string): string {
  return value.replace(/\s+/g, ' ').replace(/\u00a0/g, ' ').trim();
}

function articleDates(summary: string, content: string) {
  const fromSummary = extractDatesFromText(summary);
  const fromContent = extractDatesFromText(content);
  return {
    registration_start: fromSummary.registration_start ?? fromContent.registration_start,
    registration_end: fromSummary.registration_end ?? fromContent.registration_end,
    event_start: fromSummary.event_start ?? fromContent.event_start,
    event_end: fromSummary.event_end ?? fromContent.event_end
  };
}

export function parseJingsaiList(
  html: string,
  channel: JingsaiChannel,
  pageUrl: string,
  now = new Date()
): Competition[] {
  const $ = load(html);
  const baseHref = $('base').attr('href');
  const linkBase = baseHref ? absoluteUrl(baseHref, pageUrl) : `${WEB_BASE}/`;
  const timestamp = nowIso(now);
  const items: Competition[] = [];

  $('dl.bbda').each((_, element) => {
    const dl = $(element);
    const link = dl.find('dt.xs2_tit a').first();
    const href = link.attr('href') ?? '';
    const idMatch = href.match(/article-(\d+)-/);
    if (!idMatch) return;
    const title = cleanText(link.attr('title') ?? link.text());
    if (!title) return;

    const summaryNode = dl.find('dd.xs2').first().clone();
    summaryNode.find('.list_info, script, style').remove();
    const summary = buildSummary([cleanText(summaryNode.text())], 260);
    const dateText = cleanText(dl.find('.list_info .xg1').first().text());
    const coverRaw =
      dl.find('div.atc img').first().attr('src') ??
      dl.find('div.atc img').first().attr('data-src') ??
      '';
    const tags: string[] = [];
    if (/榜单/.test(title)) tags.push('榜单竞赛');
    if (/国家级|全国/.test(title)) tags.push('国家级');
    const category =
      channel.category === 'comprehensive' ? inferCategoryFromText(`${title} ${summary ?? ''}`) : channel.category;
    const dates = articleDates(summary ?? '', '');
    const articleUrl = absoluteUrl(href, linkBase);

    items.push({
      id: `jingsai52:${idMatch[1]}`,
      source: 'jingsai52',
      source_id: idMatch[1],
      title,
      url: articleUrl,
      summary,
      cover_url: coverRaw ? absoluteUrl(coverRaw, linkBase) : null,
      organizer: [],
      level: inferLevelFromText(title),
      level_label: null,
      category: category === 'unknown' ? channel.category : category,
      category_label: channel.label,
      tags: [...new Set(tags)],
      registration_start: dates.registration_start,
      registration_end: dates.registration_end,
      event_start: dates.event_start,
      event_end: dates.event_end,
      fee: null,
      eligibility: null,
      format: inferFormat(`${title} ${summary ?? ''}`),
      official: false,
      catalog_id: null,
      catalog_url: null,
      canonical_key: canonicalKey(title),
      fetched_at: timestamp,
      updated_at: timestamp
    });

    if (dateText) {
      const published = parseDateToIso(dateText);
      if (published) {
        const item = items.at(-1);
        if (item) item.tags.push(`发布:${published.slice(0, 10)}`);
      }
    }
  });

  return items;
}

export interface JingsaiDetailResult {
  competition: Partial<Competition>;
  content: string;
  links: string[];
  extracted: ExtractedClues;
}

export function parseJingsaiDetail(html: string, articleUrl: string): JingsaiDetailResult {
  const $ = load(html);
  const title = cleanText($('h1.ph').first().text());
  const summary = cleanText($('div.zhaiyao').first().text()).replace(/^摘要[:：]\s*/, '');
  const contentNode = $('div.d').first();
  const contentHtml = contentNode.html() ?? '';
  const content = htmlToText(contentHtml);
  const links = extractLinks(contentHtml, articleUrl);
  const allText = `${summary}\n${content}`;
  const clues = extractClues(allText, links);
  const dates = articleDates(summary, content);
  const organizer = normalizeOrganizer(
    (clues.organizer_text ?? '')
      .replace(/^主办(?:单位|方)[：:]\s*/, '')
      .replace(/^承办(?:单位|方)[：:]\s*/, '')
      .split(/[；;。]/)[0] ?? ''
  );
  const eligibilityMatch = allText.match(/(?:参赛对象|参赛资格|参赛要求|参赛范围)[：:]\s*[^\n。；;]{2,120}/);

  return {
    competition: {
      title: title || undefined,
      summary: summary || null,
      organizer,
      level: inferLevelFromText(title),
      category: inferCategoryFromText(`${title} ${summary}`),
      registration_start: dates.registration_start,
      registration_end: dates.registration_end,
      event_start: dates.event_start,
      event_end: dates.event_end,
      fee: clues.fee_text,
      eligibility: eligibilityMatch?.[0] ?? null,
      format: inferFormat(allText)
    },
    content,
    links: links.map((link) => link.url),
    extracted: clues
  };
}

export class Jingsai52Adapter {
  constructor(
    private readonly options: {
      enabled: boolean;
      minIntervalMs: number;
    } = { enabled: config.jingsai52Enabled, minIntervalMs: config.jingsai52MinIntervalMs }
  ) {}

  private assertEnabled(): void {
    if (!this.options.enabled) {
      throw new HttpError('SOURCE_DISABLED', '52jingsai adapter is disabled', null, false);
    }
  }

  async list(
    channel: JingsaiChannel,
    page = 1
  ): Promise<{ items: Competition[]; pageUrl: string; rawHtml: string }> {
    this.assertEnabled();
    const pageUrl = new URL('index.php', channel.url);
    pageUrl.searchParams.set('page', String(Math.max(1, page)));
    const html = await fetchText(pageUrl.toString(), {
      encoding: 'gb18030',
      minIntervalMs: this.options.minIntervalMs
    });
    return { items: parseJingsaiList(html, channel, pageUrl.toString()), pageUrl: pageUrl.toString(), rawHtml: html };
  }

  async detail(articleUrl: string): Promise<JingsaiDetailResult> {
    this.assertEnabled();
    const html = await fetchText(articleUrl, {
      encoding: 'gb18030',
      minIntervalMs: this.options.minIntervalMs
    });
    return parseJingsaiDetail(html, articleUrl);
  }
}
