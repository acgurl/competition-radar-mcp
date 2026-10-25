export const SOURCE_IDS = ['saikr', 'jingsai52'] as const;
export type SourceId = (typeof SOURCE_IDS)[number];

export const LEVELS = [
  'school',
  'city',
  'province',
  'national',
  'global',
  'free',
  'other',
  'unknown'
] as const;
export type Level = (typeof LEVELS)[number];

export const CATEGORIES = [
  'ai',
  'computer',
  'math',
  'engineering',
  'science',
  'business',
  'design',
  'language',
  'humanities',
  'sports',
  'comprehensive',
  'other',
  'unknown'
] as const;
export type Category = (typeof CATEGORIES)[number];

export const STATUSES = [
  'upcoming',
  'registering',
  'registration_closed',
  'ongoing',
  'ended',
  'unknown'
] as const;
export type Status = (typeof STATUSES)[number];

export const FORMATS = ['online', 'offline', 'hybrid', 'unknown'] as const;
export type CompetitionFormat = (typeof FORMATS)[number];

export interface Competition {
  id: string;
  source: SourceId;
  source_id: string;
  title: string;
  url: string;
  summary: string | null;
  cover_url: string | null;
  organizer: string[];
  level: Level;
  level_label: string | null;
  category: Category;
  category_label: string | null;
  tags: string[];
  registration_start: string | null;
  registration_end: string | null;
  event_start: string | null;
  event_end: string | null;
  fee: string | null;
  eligibility: string | null;
  format: CompetitionFormat;
  official: boolean;
  catalog_id: string | null;
  catalog_url: string | null;
  canonical_key: string;
  fetched_at: string;
  updated_at: string;
}

export interface SourceRef {
  source: SourceId;
  id: string;
  url: string;
  title: string;
}

export interface CompetitionSummary extends Competition {
  status: Status;
  sources: SourceRef[];
  days_left?: number;
}

export interface ExtractedClues {
  registration_text: string | null;
  event_text: string | null;
  fee_text: string | null;
  format_text: string | null;
  organizer_text: string | null;
  official_url: string | null;
}

export interface CompetitionDetail extends CompetitionSummary {
  status: Status;
  content?: string;
  content_truncated?: boolean;
  links?: string[];
  extracted?: ExtractedClues;
  catalog?: CatalogItem | null;
}

export interface CatalogItem {
  id: string;
  no: number | null;
  name: string;
  aliases: string[];
  url: string | null;
  category: Category;
  typical_months: number[];
  note: string | null;
  version?: string;
}

export interface CatalogFile {
  version: string;
  source: string;
  months_source?: string;
  updated_at: string;
  items: Omit<CatalogItem, 'version'>[];
}

export interface SourceState {
  source: string;
  last_sync: string | null;
  last_error: string | null;
  item_count: number;
}

export interface ToolError {
  source: string;
  code: string;
  message: string;
  retryable: boolean;
}

export interface SyncResult {
  source: string;
  added: number;
  updated: number;
  unchanged: number;
  duration_ms: number;
  skipped?: boolean;
  matched?: number;
  error?: string;
}

export interface SearchOptions {
  query?: string;
  source?: SourceId;
  category?: Category;
  level?: Level;
  status?: Status;
  deadline_within_days?: number;
  official_only?: boolean;
  include_past?: boolean;
  live?: boolean;
  sort?: 'relevance' | 'deadline' | 'event_start' | 'updated';
  limit?: number;
  offset?: number;
}

export interface SearchResult {
  total: number;
  returned: number;
  items: CompetitionSummary[];
  errors: ToolError[];
  cached: boolean;
  source_total?: number;
}

export interface DeadlineResult {
  total: number;
  returned: number;
  items: (CompetitionSummary & { days_left: number })[];
  errors: ToolError[];
}

export interface CatalogSearchResult {
  total: number;
  returned: number;
  items: (CatalogItem & { matched_competitions: number })[];
}

export interface StatsResult {
  competitions: number;
  by_source: Record<string, number>;
  by_status: Record<string, number>;
  by_category: Record<string, number>;
  official: number;
  catalog: number;
  last_sync: Record<string, string | null>;
}
