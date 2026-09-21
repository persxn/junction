import { pino } from 'pino';

import { clistListingUrl, CLIST_ORIGIN } from '../adapters/clist/adapter.js';
import { resolveCredential } from '../modules/sources/credentials.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { SetupRepository } from '../modules/setup/repository.js';
import { SetupService } from '../modules/setup/service.js';
import { SCRAPER_CONTACT_EMAIL } from '../modules/org/settings.js';
import { AuditLog } from '../platform/audit.js';
import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase } from '../platform/db.js';
import { acquireDataDirLock } from '../platform/lock.js';
import { runMigrations } from '../platform/migrate.js';
import { resolveResources } from '../platform/resources.js';
import { SettingsStore } from '../platform/settings.js';
import { hasNetworkInterface } from '../jobs/online.js';
import {
  closeTransport,
  HttpCacheStore,
  ScrapingHttp,
  undiciFetcher,
} from '../scraping/http/index.js';
import { sourceRequestContext } from '../scraping/source-row.js';
import '../settings.js';

/**
 * `pnpm --filter @compintel/backend clist:smoke` (WP-11). A developer's tool,
 * bundled nowhere and wired into no job.
 *
 * Makes **one** listing request to CLIST, and only when both hold: the API
 * credential is set (U4) and the setup wizard has finished (A10). Otherwise it
 * prints "U4 open — skipped" and exits 0. It never creates an account, never
 * falls back to a website session and never fetches clist.by HTML; the request
 * goes through the same polite client, gate and robots exemption as a
 * scheduled run.
 */

const logger = pino({ level: 'info' });
const DAY_MS = 86_400_000;

async function main(): Promise<number> {
  const config = loadConfig({ argv: ['--dev'] });
  ensureDataDirs(config);
  const lock = acquireDataDirLock(config, logger);
  const resources = resolveResources(config, import.meta.url);
  const db = openDatabase(config, { logger, nativeBinding: resources.nativeBinding });
  try {
    runMigrations(config, db, { migrationsDir: resources.migrationsDir, logger });
    const settings = new SettingsStore(db);
    const setup = new SetupService({
      repository: new SetupRepository(db),
      settings,
      audit: new AuditLog(db),
      dataDir: config.dataDir,
      appVersion: config.appVersion,
    });
    const source = new SourcesRepository(db).findByKey('clist');
    const credential = source === undefined ? undefined : resolveCredential(source, settings);
    const contact = settings.get(SCRAPER_CONTACT_EMAIL).trim();
    if (
      source === undefined ||
      credential === undefined ||
      setup.isRequired() ||
      contact.length === 0
    ) {
      process.stdout.write('U4 open — skipped\n');
      return 0;
    }

    const http = new ScrapingHttp({
      fetcher: undiciFetcher,
      logger,
      cache: new HttpCacheStore(db),
      appVersion: config.appVersion,
      contactEmail: () => contact,
      setupComplete: () => !setup.isRequired(),
      hasNetworkInterface,
    });
    const client = http.clientFor(
      sourceRequestContext(source, credential),
      new AbortController().signal,
      {
        maxRequests: 1,
      },
    );
    const now = Date.now();
    const url = clistListingUrl(
      CLIST_ORIGIN,
      { from: new Date(now - DAY_MS), to: new Date(now + 90 * DAY_MS) },
      0,
    );
    const response = await client.get(url, { accept: 'application/json' });
    const body = response.json() as {
      meta?: { total_count?: number };
      objects?: { event?: string }[];
    };
    process.stdout.write(
      `${JSON.stringify(
        {
          status: response.status,
          totalCount: body.meta?.total_count ?? null,
          firstTitles: (body.objects ?? []).slice(0, 3).map((contest) => contest.event ?? null),
          requestsMade: client.requestsMade,
        },
        null,
        2,
      )}\n`,
    );
    return 0;
  } finally {
    await closeTransport();
    db.close();
    lock.release();
  }
}

process.exitCode = await main();
