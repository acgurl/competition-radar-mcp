import { CompetitionService } from '../services/competitions.js';
import { config } from '../config.js';

const live = process.argv.includes('--live');
const service = new CompetitionService();
await service.init();

const report: Record<string, unknown> = {
  db: config.dbPath,
  catalog: config.catalogPath,
  saikr_enabled: config.saikrEnabled,
  jingsai52_enabled: config.jingsai52Enabled,
  stats: service.stats(),
  sources: service.listSources()
};

if (live) {
  const started = Date.now();
  try {
    const search = await service.search({ query: '数学', live: true, limit: 5 });
    report.live_search = {
      total: search.total,
      returned: search.returned,
      errors: search.errors,
      sample: search.items.slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        status: item.status
      })),
      duration_ms: Date.now() - started
    };
    const first = search.items[0];
    if (first) {
      const detail = await service.getCompetition({ id: first.id, include_content: true });
      report.live_detail = {
        id: first.id,
        has_content: Boolean(detail.item?.content),
        content_length: detail.item?.content?.length ?? 0,
        errors: detail.errors
      };
    }
  } catch (error) {
    report.live_error = error instanceof Error ? error.message : String(error);
  }
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
service.close();
