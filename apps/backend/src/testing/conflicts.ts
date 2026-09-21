import { Geocoder } from '../modules/geo/geocoder.js';
import { createCategoriesModule } from '../modules/categories/wiring.js';
import { createEventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import type { DatabaseHandle } from '../platform/db.js';
import { unavailableGazetteer } from '../platform/gazetteer.js';
import { SettingsStore } from '../platform/settings.js';
import { ingestInto, loadScenario, toCandidate } from './events.js';
import { insertSource, silentLogger } from './scraping.js';

/**
 * Loading a conflict scenario into any migrated database (WP-16b).
 *
 * `pnpm seed:demo` uses it so the E2E run and a manual demo both open a drawer
 * with a real "Sources disagree" panel in it. It goes through the linker — the
 * same per-item transaction a scrape uses — rather than writing rows, because a
 * fixture that inserted its own claims would prove that the fixture agrees with
 * itself and nothing else.
 *
 * It is in `testing/` and not in a module because that is what it is: demo and
 * test data. Nothing in the running application reaches it.
 */

export interface SeedScenarioResult {
  readonly eventId: string;
  readonly sources: number;
  readonly records: number;
}

export function seedScenario(
  db: DatabaseHandle,
  name: string,
  options: { readonly folder?: string; readonly at?: number } = {},
): SeedScenarioResult {
  const scenario = loadScenario(name, options.folder ?? 'conflicts');
  const at = options.at ?? Date.now();
  const settings = new SettingsStore(db);
  const audit = new AuditLog(db);
  const categories = createCategoriesModule({ db, audit });
  const events = createEventsModule({
    db,
    categories: categories.repo,
    geocoder: new Geocoder({
      gazetteer: unavailableGazetteer('the demo seed does not geocode'),
      institutions: [],
    }),
    settings,
    audit,
    logger: silentLogger,
    onResolved: (eventId, when) => {
      categories.classifier.classifyEvent(eventId, when);
    },
  });
  const sources = new SourcesRepository(db);
  const records = new SourceRecordsRepository(db);

  for (const extra of scenario.sources) {
    if (sources.findByKey(extra.key) === undefined) {
      insertSource(db, {
        key: extra.key,
        name: extra.key,
        trustRank: extra.trustRank,
        adapter: extra.adapter,
      });
    }
  }

  let eventId: string | undefined;
  for (const entry of scenario.records) {
    const source = sources.findByKey(entry.sourceKey);
    if (source === undefined) {
      throw new Error(`the scenario names a source "${entry.sourceKey}" that is not seeded`);
    }
    const record = ingestInto({
      records,
      source,
      linker: events.linker,
      candidate: toCandidate(entry.sourceKey, entry.externalKey, entry.candidate),
      at,
    });
    eventId = record.eventId ?? eventId;
  }
  if (eventId === undefined) {
    throw new Error(`${name} produced no event`);
  }
  return { eventId, sources: scenario.sources.length, records: scenario.records.length };
}
