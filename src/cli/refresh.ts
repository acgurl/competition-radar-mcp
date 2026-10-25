import { CompetitionService } from '../services/competitions.js';
import { config } from '../config.js';

function parseArgs(argv: string[]) {
  let source: 'all' | 'saikr' | 'jingsai52' | 'catalog' = 'all';
  let pages = 3;
  let force = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--source') {
      const value = argv[i + 1];
      if (value === 'all' || value === 'saikr' || value === 'jingsai52' || value === 'catalog') {
        source = value;
      }
      i += 1;
    } else if (arg === '--pages') {
      const value = Number(argv[i + 1]);
      if (Number.isFinite(value) && value > 0) pages = Math.min(20, Math.trunc(value));
      i += 1;
    } else if (arg === '--force') {
      force = true;
    }
  }
  return { source, pages, force };
}

const args = parseArgs(process.argv.slice(2));
const service = new CompetitionService();
await service.init();
process.stderr.write(`db: ${config.dbPath}\n`);
const results = await service.refresh({
  source: args.source,
  max_pages: args.pages,
  force: args.force
});
process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
service.close();
