import test from 'node:test';
import assert from 'node:assert/strict';
import { Store, mergeCompetition } from '../src/store.js';
import { CompetitionService } from '../src/services/competitions.js';
import { nowIso, canonicalKey } from '../src/normalize.js';
import type { Competition } from '../src/types.js';
import type { SaikrAdapter } from '../src/sources/saikr.js';
import type { Jingsai52Adapter } from '../src/sources/jingsai52.js';

const fakeSaikr = {
  search: async () => ({ items: [], total: 0 }),
  list: async () => ({ items: [], total: 0 }),
  detail: async () => {
    throw new Error('not used');
  }
} as unknown as SaikrAdapter;

const fakeJingsai = {
  list: async () => ({ items: [], pageUrl: '', rawHtml: '' }),
  detail: async () => {
    throw new Error('not used');
  }
} as unknown as Jingsai52Adapter;

function competition(
  id: string,
  source: 'saikr' | 'jingsai52',
  title: string,
  overrides: Partial<Competition> = {}
): Competition {
  const timestamp = nowIso();
  return {
    id,
    source,
    source_id: id.split(':')[1],
    title,
    url: `https://example.com/${id}`,
    summary: null,
    cover_url: null,
    organizer: [],
    level: 'national',
    level_label: null,
    category: 'business',
    category_label: null,
    tags: [],
    registration_start: null,
    registration_end: null,
    event_start: null,
    event_end: null,
    fee: null,
    eligibility: null,
    format: 'unknown',
    official: false,
    catalog_id: null,
    catalog_url: null,
    canonical_key: canonicalKey(title),
    fetched_at: timestamp,
    updated_at: timestamp,
    ...overrides
  };
}

test('store upserts and merges same competition from two sources', async () => {
  const store = new Store(':memory:');
  const service = new CompetitionService({ store, saikr: fakeSaikr, jingsai52: fakeJingsai });
  const saikr = competition('saikr:1', 'saikr', '2026年第十七届全国大学生市场调查与分析大赛', {
    summary: 'saikr summary',
    registration_end: '2026-11-30T23:59:59+08:00'
  });
  const jingsai = competition('jingsai52:2', 'jingsai52', '【榜单竞赛】第十七届全国大学生市场调查与分析大赛报名通知', {
    summary: '52 summary'
  });

  assert.equal(store.upsertCompetition(saikr), 'added');
  assert.equal(store.upsertCompetition(jingsai), 'added');
  assert.equal(store.countCompetitions(), 2);

  const result = await service.search({ live: false });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].sources.length, 2);
  assert.ok(result.items[0].registration_end);

  const byName = await service.search({ query: '市场调查', live: false });
  assert.equal(byName.total, 1);

  service.close();
});

test('mergeCompetition keeps a slug URL over a numeric fallback', () => {
  const existing = competition('saikr:1', 'saikr', 'A', { url: 'https://www.saikr.com/vse/slug' });
  const incoming = competition('saikr:1', 'saikr', 'A', { url: 'https://www.saikr.com/vse/12345' });
  assert.equal(mergeCompetition(existing, incoming).url, 'https://www.saikr.com/vse/slug');

  const incomingUnknown = competition('saikr:1', 'saikr', 'A', {
    level: 'unknown',
    category: 'unknown',
    organizer: [],
    tags: []
  });
  const merged = mergeCompetition(existing, incomingUnknown);
  assert.equal(merged.level, existing.level);
  assert.equal(merged.category, existing.category);
});

test('listDeadlines filters by upcoming registration end', async () => {
  const store = new Store(':memory:');
  const service = new CompetitionService({ store, saikr: fakeSaikr, jingsai52: fakeJingsai });
  const soon = new Date(Date.now() + 5 * 86_400_000);
  const later = new Date(Date.now() + 60 * 86_400_000);
  store.upsertCompetition(
    competition('saikr:1', 'saikr', '五天后截止', {
      registration_end: nowIso(soon),
      registration_start: '2026-01-01T00:00:00+08:00'
    })
  );
  store.upsertCompetition(
    competition('saikr:2', 'saikr', '六十天后截止', {
      registration_end: nowIso(later),
      registration_start: '2026-01-01T00:00:00+08:00'
    })
  );

  const result = await service.listDeadlines({ days: 10 });
  assert.equal(result.total, 1);
  assert.equal(result.items[0].title, '五天后截止');
  assert.ok(result.items[0].days_left <= 5);

  const stats = service.stats();
  assert.equal(stats.competitions, 2);
  assert.equal(stats.by_source.saikr, 2);

  service.close();
});

test('detail cache round trips', () => {
  const store = new Store(':memory:');
  store.upsertCompetition(competition('saikr:1', 'saikr', 'A'));
  store.saveDetail('saikr:1', {
    content: '正文',
    links: ['https://example.com'],
    extracted: {
      registration_text: null,
      event_text: null,
      fee_text: null,
      format_text: null,
      organizer_text: null,
      official_url: null
    },
    fetched_at: nowIso()
  });
  const detail = store.getDetail('saikr:1');
  assert.equal(detail?.content, '正文');
  assert.deepEqual(detail?.links, ['https://example.com']);
  assert.equal(detail?.extracted?.official_url, null);
  store.close();
});
