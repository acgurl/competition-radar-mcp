import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalKey,
  computeStatus,
  daysUntil,
  diceSimilarity,
  extractDatesFromText,
  extractClues,
  htmlToText,
  inferCategoryFromText,
  inferLevelFromText,
  matchCatalog,
  normalizeTitle,
  parseDateToIso
} from '../src/normalize.js';
import type { CatalogItem, Competition } from '../src/types.js';

const catalog: CatalogItem[] = [
  {
    id: 'official-005',
    no: 5,
    name: '全国大学生数学建模竞赛',
    aliases: ['数模', '国赛', 'CUMCM'],
    url: 'http://www.mcm.edu.cn/',
    category: 'math',
    typical_months: [9],
    note: null
  },
  {
    id: 'official-020',
    no: 20,
    name: '全国大学生市场调查与分析大赛',
    aliases: ['市调大赛'],
    url: 'http://www.china-cssc.org/',
    category: 'business',
    typical_months: [9],
    note: null
  }
];

function competition(overrides: Partial<Competition>): Pick<Competition, 'registration_start' | 'registration_end' | 'event_start' | 'event_end'> {
  return {
    registration_start: null,
    registration_end: null,
    event_start: null,
    event_end: null,
    ...overrides
  };
}

test('normalizeTitle removes year, edition, prefix and punctuation', () => {
  const a = normalizeTitle('【榜单竞赛】第十七届全国大学生市场调查与分析大赛报名通知');
  const b = normalizeTitle('2026年第十七届全国大学生市场调查与分析大赛');
  assert.equal(a, b);
  assert.equal(canonicalKey('【榜单竞赛】第十七届全国大学生市场调查与分析大赛报名通知'), canonicalKey('2026年第十七届全国大学生市场调查与分析大赛'));
  assert.equal(
    normalizeTitle('关于举办第二十八届中国机器人及人工智能大赛的预通知'),
    normalizeTitle('第二十八届中国机器人及人工智能大赛')
  );
});

test('parseDateToIso handles epoch, Chinese dates and end of day', () => {
  assert.equal(parseDateToIso(1792929600), '2026-10-25T20:00:00+08:00');
  assert.equal(parseDateToIso('2026/10/24 10:00:00'), '2026-10-24T10:00:00+08:00');
  assert.equal(parseDateToIso('2026年10月31日', { endOfDay: true }), '2026-10-31T23:59:59+08:00');
  assert.equal(parseDateToIso('not a date'), null);
});

test('computeStatus follows registration and event windows', () => {
  const base = competition({
    registration_start: '2026-10-01T00:00:00+08:00',
    registration_end: '2026-10-20T23:59:59+08:00',
    event_start: '2026-11-01T09:00:00+08:00',
    event_end: '2026-11-02T18:00:00+08:00'
  });
  const at = (iso: string) => Date.parse(iso);
  assert.equal(computeStatus(base, at('2026-10-25T12:00:00+08:00')), 'registration_closed');
  assert.equal(computeStatus(base, at('2026-11-01T12:00:00+08:00')), 'ongoing');
  assert.equal(computeStatus(base, at('2026-11-03T12:00:00+08:00')), 'ended');
  assert.equal(
    computeStatus(competition({ registration_start: '2026-11-01T00:00:00+08:00' }), at('2026-10-25T12:00:00+08:00')),
    'upcoming'
  );
  assert.equal(computeStatus(competition({}), at('2026-10-25T12:00:00+08:00')), 'unknown');
});

test('daysUntil uses calendar days in Asia/Shanghai', () => {
  const now = Date.parse('2026-10-25T12:00:00+08:00');
  assert.equal(daysUntil('2026-10-26T12:00:00+08:00', now), 1);
  assert.equal(daysUntil('2026-10-25T13:00:00+08:00', now), 0);
  assert.equal(daysUntil('2026-11-01T00:00:00+08:00', now), 7);
  assert.equal(daysUntil(null, now), null);
});

test('category and level inference', () => {
  assert.equal(inferCategoryFromText('全国大学生数学建模竞赛'), 'math');
  assert.equal(inferCategoryFromText('2026年人工智能创新挑战赛'), 'ai');
  assert.equal(inferCategoryFromText('全国大学生广告艺术大赛'), 'design');
  assert.equal(inferLevelFromText('2026年省级大学生竞赛'), 'province');
  assert.equal(inferLevelFromText('全国大学生英语竞赛'), 'national');
  assert.equal(inferLevelFromText('校级校园歌手大赛'), 'school');
});

test('catalog matching uses exact names and aliases', () => {
  assert.equal(matchCatalog('2026年全国大学生数学建模竞赛', catalog)?.item.id, 'official-005');
  assert.equal(matchCatalog('数模', catalog)?.item.id, 'official-005');
  assert.equal(matchCatalog('第十七届全国大学生市场调查与分析大赛', catalog)?.item.id, 'official-020');
  assert.equal(matchCatalog('2026年某某杯篮球联赛', catalog), null);
});

test('dice similarity is symmetric and bounded', () => {
  assert.equal(diceSimilarity('数学建模', '数学建模'), 1);
  assert.equal(diceSimilarity('数学建模', ''), 0);
  assert.equal(diceSimilarity('数学建模', '数学竞赛'), diceSimilarity('数学竞赛', '数学建模'));
});

test('extractDatesFromText keeps deadline at end of day', () => {
  const dates = extractDatesFromText('报名截止时间：2026年11月20日中午12点');
  assert.equal(dates.registration_end, '2026-11-20T23:59:59+08:00');
  const event = extractDatesFromText('比赛时间：2026年11月21日');
  assert.equal(event.event_start, '2026-11-21T00:00:00+08:00');
});

test('htmlToText strips markup', () => {
  const text = htmlToText('<p>主办单位：A</p><p>报名时间：2026年10月1日</p>');
  assert.match(text, /主办单位：A/);
  assert.match(text, /报名时间/);
  assert.doesNotMatch(text, /<p>/);
});

test('fee extraction prefers an explicit registration fee over free certificates', () => {
  const clues = extractClues('免费申领大赛荣誉证书；报名费（含网考费）30元/人；');
  assert.match(clues.fee_text ?? '', /30元/);
  const noisy = extractClues('参赛费的人数计算，未超过200人的按人数计算；报名费30元/人。');
  assert.match(noisy.fee_text ?? '', /30元/);
  assert.doesNotMatch(noisy.fee_text ?? '', /人数计算/);
});
