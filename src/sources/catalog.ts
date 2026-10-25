import { readFile } from 'node:fs/promises';
import { CATEGORIES, type CatalogFile, type CatalogItem, type Category } from '../types.js';

function normalizeCategory(value: unknown): Category {
  return typeof value === 'string' && (CATEGORIES as readonly string[]).includes(value)
    ? (value as Category)
    : 'unknown';
}

export async function readCatalog(path: string): Promise<{ meta: Omit<CatalogFile, 'items'>; items: CatalogItem[] }> {
  const raw = await readFile(path, 'utf8');
  const parsed = JSON.parse(raw) as Partial<CatalogFile>;
  if (!Array.isArray(parsed.items)) throw new Error(`invalid catalog file: ${path}`);
  const version = String(parsed.version ?? 'unknown');
  const items: CatalogItem[] = parsed.items.map((item) => ({
    id: String(item.id),
    no: typeof item.no === 'number' ? item.no : null,
    name: String(item.name),
    aliases: Array.isArray(item.aliases) ? item.aliases.map(String) : [],
    url: item.url ? String(item.url) : null,
    category: normalizeCategory(item.category),
    typical_months: Array.isArray(item.typical_months)
      ? item.typical_months.map(Number).filter((m) => m >= 1 && m <= 12)
      : [],
    note: item.note ? String(item.note) : null,
    version
  }));
  return {
    meta: {
      version,
      source: String(parsed.source ?? ''),
      months_source: parsed.months_source ? String(parsed.months_source) : undefined,
      updated_at: String(parsed.updated_at ?? '')
    },
    items
  };
}
