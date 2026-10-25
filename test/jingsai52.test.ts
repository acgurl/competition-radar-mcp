import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  JINGSAI_CHANNELS,
  parseJingsaiDetail,
  parseJingsaiList
} from '../src/sources/jingsai52.js';

const listHtml = readFileSync(new URL('./fixtures/jingsai-list.html', import.meta.url), 'utf8');
const detailHtml = readFileSync(new URL('./fixtures/jingsai-detail.html', import.meta.url), 'utf8');
const channel = JINGSAI_CHANNELS[0];

test('parseJingsaiList extracts list items', () => {
  const items = parseJingsaiList(
    listHtml,
    channel,
    'https://www.52jingsai.com/bisai/xkjn/bangdan/index.php?page=1',
    new Date('2026-10-25T12:00:00+08:00')
  );
  assert.ok(items.length > 10);
  const item = items.find((entry) => entry.id === 'jingsai52:24110');
  assert.ok(item);
  assert.match(item.title, /市场调查与分析大赛/);
  assert.equal(item.url, 'https://www.52jingsai.com/article-24110-1.html');
  assert.equal(item.level, 'national');
  assert.equal(item.category, 'business');
  assert.equal(item.registration_end, '2026-10-31T23:59:59+08:00');
  assert.match(item.summary ?? '', /主办单位/);
  assert.ok(item.tags.includes('榜单竞赛'));
  assert.ok(item.cover_url?.startsWith('https://'));
});

test('parseJingsaiDetail extracts body, organizer and dates', () => {
  const result = parseJingsaiDetail(detailHtml, 'https://www.52jingsai.com/article-24110-1.html');
  assert.match(result.competition.title ?? '', /市场调查与分析大赛/);
  assert.match(result.content, /主办单位/);
  assert.match(result.content, /中国商业统计学会/);
  assert.ok(result.competition.organizer?.includes('中国商业统计学会'));
  assert.match(result.extracted.organizer_text ?? '', /中国商业统计学会/);
  assert.equal(result.competition.registration_end, '2026-10-31T23:59:59+08:00');
  assert.ok(result.links.length > 0);
  assert.ok(result.links.every((link) => link.startsWith('http')));
});
