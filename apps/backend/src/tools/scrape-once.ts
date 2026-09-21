import { pino } from 'pino';

import { sourceRecords } from '../db/schema/index.js';
import { Geocoder } from '../modules/geo/geocoder.js';
import { loadInstitutions } from '../modules/geo/seed.js';
import { SCRAPER_CONTACT_EMAIL } from '../modules/org/settings.js';
import { SetupRepository } from '../modules/setup/repository.js';
import { SetupService } from '../modules/setup/service.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase } from '../platform/db.js';
import { openGazetteer, unavailableGazetteer } from '../platform/gazetteer.js';
import { acquireDataDirLock } from '../platform/lock.js';
import { runMigrations } from '../platform/migrate.js';
import { resolveResources } from '../platform/resources.js';
import { SettingsStore } from '../platform/settings.js';
import { systemClock } from '../platform/time.js';
import { hasNetworkInterface } from '../jobs/online.js';
import {
  closeTransport,
  HttpCacheStore,
  ScrapingHttp,
  undiciFetcher,
  type Fetcher,
} from '../scraping/http/index.js';
import { runScrape } from '../scraping/run.js';
import { SnapshotStore } from '../scraping/snapshots.js';
import { adapterRegistry, registerBuiltInAdapters } from '../sources/registry.js';
import '../settings.js';
import { parseSourceArg, scrapeOnceRefusal } from './scrape-once-check.js';

/**
 * `pnpm --filter @compintel/backend scrape:once -- --source <key>` (WP-09b).
 *
 * A developer's tool: exactly one real run of one source through WP-09a's
 * orchestrator against the dev data directory, printing the `scrape_runs` row.
 * It is wired into no job and no bundle (`bundle.ts` builds `main.ts` only),
 * and it makes the same requests a scheduled run would — same client, same
 * gate, same delay, same User-Agent. The only addition is a log line per
 * request so the politeness can be read off the terminal.
 */

const logger = pino({ level: 'info' });

/** Logs each request's URL, User-Agent and the gap since the previous one started. */
function loggingFetcher(inner: Fetcher): Fetcher {
  let previous: number | undefined;
  return async (request) => {
    const at = Date.now();
    logger.info(
      {
        method: request.method,
        url: request.url,
        userAgent: request.headers['user-agent'],
        gapMs: previous === undefined ? null : at - previous,
      },
      'request',
    );
    previous = at;
    const response = await inner(request);
    logger.info({ url: request.url, status: response.status }, 'response');
    return response;
  };
}

async function main(): Promise<number> {
  const key = parseSourceArg(process.argv.slice(2));
  if (key === undefined) {
    logger.error('usage: scrape:once -- --source <key>');
    return 2;
  }

  const config = loadConfig({ argv: ['--dev'] });
  ensureDataDirs(config);
  const lock = acquireDataDirLock(config, logger);
  const resources = resolveResources(config, import.meta.url);
  const db = openDatabase(config, { logger, nativeBinding: resources.nativeBinding });
  try {
    runMigrations(config, db, { migrationsDir: resources.migrationsDir, logger });
    const settings = new SettingsStore(db);
    const audit = new AuditLog(db);
    const setup = new SetupService({
      repository: new SetupRepository(db),
      settings,
      audit,
      dataDir: config.dataDir,
      appVersion: config.appVersion,
    });
    const gazetteer =
      resources.gazetteerFile === undefined
        ? unavailableGazetteer('no gazetteer was built')
        : openGazetteer(resources.gazetteerFile, { logger });
    registerBuiltInAdapters(adapterRegistry, {
      geo: new Geocoder({ gazetteer, institutions: loadInstitutions(db) }),
    });

    const sources = new SourcesRepository(db);
    const records = new SourceRecordsRepository(db);
    const source = sources.findByKey(key);
    const now = Date.now();
    const refusal = scrapeOnceRefusal(
      source,
      source === undefined ? undefined : sources.state(source.id, now),
      adapterRegistry,
      now,
    );
    const adapter = source === undefined ? undefined : adapterRegistry.get(source.key);
    if (refusal !== undefined || source === undefined || adapter === undefined) {
      logger.error({ source: key }, refusal ?? 'refused');
      return 1;
    }

    const http = new ScrapingHttp({
      fetcher: loggingFetcher(undiciFetcher),
      logger,
      cache: new HttpCacheStore(db),
      appVersion: config.appVersion,
      contactEmail: () => settings.get(SCRAPER_CONTACT_EMAIL),
      setupComplete: () => !setup.isRequired(),
      hasNetworkInterface,
    });
    const snapshots = new SnapshotStore({ config, logger });
    const row = await runScrape(
      {
        sources,
        records,
        http,
        snapshots,
        clock: systemClock,
        logger,
        setupComplete: () => !setup.isRequired(),
      },
      { source, adapter, trigger: 'MANUAL' },
    );

    const stored = db.drizzle.select().from(sourceRecords).all();
    const mine = stored.filter((record) => record.sourceId === source.id);
    const summary = {
      snapshotsRoot: snapshots.root,
      records: mine.map((record) => ({
        externalKey: record.externalKey,
        title: (JSON.parse(record.payloadJson) as { title?: string }).title,
        snapshot: record.rawSnapshotRef,
      })),
    };
    process.stdout.write(`${JSON.stringify({ scrapeRun: row }, null, 2)}\n`);
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    gazetteer.close();
    return row.outcome === 'SUCCESS' ? 0 : 1;
  } finally {
    await closeTransport();
    db.close();
    lock.release();
  }
}

process.exitCode = await main();
