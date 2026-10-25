import test from 'node:test';
import assert from 'node:assert/strict';
import { readCatalog } from '../src/sources/catalog.js';
import { matchCatalog } from '../src/normalize.js';
import { config } from '../src/config.js';
import { CATEGORIES } from '../src/types.js';

test('official catalog has 84 unique entries with valid categories', async () => {
  const { meta, items } = await readCatalog(config.catalogPath);
  assert.equal(meta.version, '2025');
  assert.equal(items.length, 84);
  assert.equal(new Set(items.map((item) => item.id)).size, 84);
  assert.equal(new Set(items.map((item) => item.name)).size, 84);
  for (const item of items) {
    assert.ok(item.name.length > 3);
    assert.ok((CATEGORIES as readonly string[]).includes(item.category));
    assert.ok(item.url === null || item.url.startsWith('http'));
  }
  const innovation = items.find((item) => item.id === 'official-001');
  assert.ok(innovation?.aliases.includes('国创赛'));
  const mathModeling = items.find((item) => item.id === 'official-005');
  assert.equal(mathModeling?.name, '全国大学生数学建模竞赛');
  assert.ok(mathModeling?.aliases.includes('数模'));
});

test('catalog matching finds official entries through aliases', async () => {
  const { items } = await readCatalog(config.catalogPath);
  assert.equal(matchCatalog('2026 年“高教社杯”全国大学生数学建模竞赛', items)?.item.id, 'official-005');
  assert.equal(matchCatalog('第十七届全国大学生市场调查与分析大赛', items)?.item.id, 'official-020');
  assert.equal(matchCatalog('蓝桥杯全国软件和信息技术专业人才大赛', items)?.item.id, 'official-027');
});
