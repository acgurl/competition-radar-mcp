import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mapSaikrListItem, parseSaikrDetail } from '../src/sources/saikr.js';

const listItem = JSON.parse(
  readFileSync(new URL('./fixtures/saikr-list-item.json', import.meta.url), 'utf8')
);
const detail = JSON.parse(readFileSync(new URL('./fixtures/saikr-detail.json', import.meta.url), 'utf8'));

test('mapSaikrListItem normalizes list fields', () => {
  const item = mapSaikrListItem(listItem, new Date('2026-10-25T12:00:00+08:00'));
  assert.equal(item.id, 'saikr:58100');
  assert.equal(item.source, 'saikr');
  assert.equal(item.source_id, '58100');
  assert.equal(item.level, 'national');
  assert.equal(item.level_label, '全国性');
  assert.equal(item.category, 'math');
  assert.equal(item.registration_start, '2026-04-29T00:00:00+08:00');
  assert.equal(item.registration_end, '2026-10-25T20:00:00+08:00');
  assert.equal(item.event_start, '2026-10-24T10:00:00+08:00');
  assert.equal(item.url, 'https://www.saikr.com/vse/LCBCXSX');
  assert.deepEqual(item.organizer, ['中国技术市场协会数智技术专业委员会 等']);
  assert.ok(item.summary?.includes('全国性'));
  assert.deepEqual(item.tags, ['数学竞赛', '单机位答题']);
  assert.equal(item.official, false);
});

test('parseSaikrDetail extracts content and clues', () => {
  const result = parseSaikrDetail(detail, new Date('2026-10-25T12:00:00+08:00'));
  const item = result.competition;
  assert.equal(item.id, 'saikr:58100');
  assert.equal(item.category, 'ai');
  assert.equal(item.level, 'national');
  assert.equal(item.registration_end, '2026-10-25T20:00:00+08:00');
  assert.equal(item.event_start, '2026-10-24T10:00:00+08:00');
  assert.equal(item.format, 'online');
  assert.equal(item.organizer.length, 2);
  assert.match(item.fee ?? '', /30元/);
  assert.match(item.eligibility ?? '', /全国高校在校学生/);
  assert.match(result.content, /主办单位/);
  assert.match(result.content, /线上答题/);
  assert.match(result.extracted.organizer_text ?? '', /中国技术市场协会/);
  assert.match(result.extracted.registration_text ?? '', /报名时间/);
  assert.equal(result.extracted.official_url, 'https://example.com/contest');
  assert.ok(result.links.includes('https://example.com/contest'));
});
