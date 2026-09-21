import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { SCRAPEABLE_COMPLIANCE_STATUSES } from '@compintel/contracts';
import { pino } from 'pino';

import { isForbidden, pathForbiddenError } from '../adapters/unstop/fetch.js';
import { UnstopDetail, UnstopListingPage } from '../domain/unstop/schema.js';
import { hasNetworkInterface } from '../jobs/online.js';
import { SCRAPER_CONTACT_EMAIL } from '../modules/org/settings.js';
import { SetupRepository } from '../modules/setup/repository.js';
import { SetupService } from '../modules/setup/service.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { ensureDataDirs, loadConfig } from '../platform/config.js';
import { openDatabase } from '../platform/db.js';
import { acquireDataDirLock } from '../platform/lock.js';
import { runMigrations } from '../platform/migrate.js';
import { resolveResources } from '../platform/resources.js';
import { SettingsStore } from '../platform/settings.js';
import {
  closeTransport,
  HttpCacheStore,
  ScrapingHttp,
  undiciFetcher,
  type Fetcher,
  type PoliteResponse,
} from '../scraping/http/index.js';
import { sourceRequestContext } from '../scraping/source-row.js';
import '../settings.js';
import {
  captureMeta,
  CAPTURE_BUDGET,
  plannedDetail,
  plannedListings,
  r71Verdict,
  scrubFixture,
  type Observation,
  type PlannedRequest,
} from './unstop-capture-plan.js';

/**
 * `pnpm --filter @compintel/backend unstop:capture` (WP-13 step 4 and its
 * manual live smoke).
 *
 * A developer's tool, bundled nowhere and wired into no job. It makes at most
 * **four** requests to Unstop — one listing per opportunity type and one detail
 * each — through the same polite client, gate, robots read, delay and
 * User-Agent a scheduled run uses, writes each answer as a fixture with its
 * `.meta.json`, and prints the request log the report has to carry.
 *
 * It refuses to run at all until the installation has a professor identity: no
 * completed setup or no `scraper.contactEmail` means no request (A10). The
 * fixtures currently in the repo are synthetic and this is what replaces them.
 *
 * By default it writes to `test/fixtures/unstop/captured/`, leaving the
 * synthetic fixtures and their goldens alone; `--replace` writes over them, and
 * then `UPDATE_GOLDEN=1 pnpm test` has to follow.
 */

const logger = pino({ level: 'info' });

interface LogEntry {
  readonly url: string;
  readonly userAgent: string | undefined;
  readonly gapMs: number | null;
  readonly status: number;
}

const log: LogEntry[] = [];

/** Records every request the client makes, with the gap since the previous one. */
function recordingFetcher(inner: Fetcher): Fetcher {
  let previous: number | undefined;
  return async (request) => {
    const at = Date.now();
    const gapMs = previous === undefined ? null : at - previous;
    previous = at;
    const response = await inner(request);
    // The body is a stream the client has yet to read; only its headers are
    // safe to look at here.
    log.push({
      url: request.url,
      userAgent: request.headers['user-agent'],
      gapMs,
      status: response.status,
    });
    return response;
  };
}

const RATE_LIMIT_HEADER = /^(retry-after|x-?ratelimit|x-rate-limit)/i;

function observe(planned: PlannedRequest, response: PoliteResponse, matched: boolean): Observation {
  const rateLimitHeaders: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (RATE_LIMIT_HEADER.test(name)) {
      rateLimitHeaders[name.toLowerCase()] = value;
    }
  }
  return {
    url: planned.url,
    at: new Date().toISOString(),
    status: response.status,
    contentType: response.headers['content-type'] ?? null,
    bytes: response.body.byteLength,
    schemaMatched: matched,
    rateLimitHeaders,
  };
}

function fixturesRoot(replace: boolean): string {
  const base = path.resolve(import.meta.dirname, '..', '..', 'test', 'fixtures', 'unstop');
  return replace ? base : path.join(base, 'captured');
}

/** The scrubbed body and its meta, side by side, as two files. */
function write(
  root: string,
  planned: PlannedRequest,
  body: unknown,
  observation: Observation,
): void {
  const scrubbed = scrubFixture(body);
  writeFileSync(
    path.join(root, `${planned.name}.json`),
    `${JSON.stringify(scrubbed.value, null, 2)}\n`,
    'utf8',
  );
  writeFileSync(
    path.join(root, `${planned.name}.meta.json`),
    `${JSON.stringify(captureMeta(observation, scrubbed.redacted), null, 2)}\n`,
    'utf8',
  );
  logger.info(
    { fixture: planned.name, redacted: scrubbed.redacted.length },
    'fixture written, personal data removed',
  );
}

/** A JSON body, or `undefined` when the answer was not JSON at all. */
function jsonOf(response: PoliteResponse): unknown {
  try {
    return response.json();
  } catch {
    return undefined;
  }
}

/** The first opportunity id on a listing page, when the page parsed. */
function firstId(body: unknown): number | undefined {
  const parsed = UnstopListingPage.safeParse(body);
  return parsed.success ? parsed.data.data.data[0]?.id : undefined;
}

async function main(): Promise<number> {
  const replace = process.argv.includes('--replace');
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
    const source = new SourcesRepository(db).findByKey('unstop');
    if (source === undefined) {
      logger.error('no unstop source row; run the migrations first');
      return 1;
    }
    if (!SCRAPEABLE_COMPLIANCE_STATUSES.includes(source.complianceStatus) || !source.isEnabled) {
      logger.error(
        { complianceStatus: source.complianceStatus, isEnabled: source.isEnabled },
        'unstop may not be requested in this database',
      );
      return 1;
    }
    const contact = settings.get(SCRAPER_CONTACT_EMAIL).trim();
    if (setup.isRequired() || contact.length === 0) {
      process.stdout.write(
        'capture owed — skipped: this installation has no professor identity yet (setup incomplete or scraper.contactEmail unset, A10). No request was made.\n',
      );
      return 0;
    }

    const http = new ScrapingHttp({
      fetcher: recordingFetcher(undiciFetcher),
      logger,
      cache: new HttpCacheStore(db),
      appVersion: config.appVersion,
      contactEmail: () => contact,
      setupComplete: () => !setup.isRequired(),
      hasNetworkInterface,
    });
    const client = http.clientFor(sourceRequestContext(source), new AbortController().signal, {
      maxRequests: CAPTURE_BUDGET,
    });

    const root = fixturesRoot(replace);
    mkdirSync(root, { recursive: true });
    const observations: Observation[] = [];
    const details: PlannedRequest[] = [];

    for (const planned of plannedListings()) {
      if (isForbidden(planned.url)) {
        throw pathForbiddenError(planned.url);
      }
      const response = await client.get(planned.url, { accept: 'application/json' });
      const body = jsonOf(response);
      const id = body === undefined ? undefined : firstId(body);
      observations.push(observe(planned, response, id !== undefined));
      write(root, planned, body ?? response.text(), observations[observations.length - 1]!);
      if (id !== undefined) {
        details.push(plannedDetail(id));
      }
    }

    for (const planned of details) {
      if (client.requestsRemaining === 0) {
        break;
      }
      if (isForbidden(planned.url)) {
        throw pathForbiddenError(planned.url);
      }
      const response = await client.get(planned.url, { accept: 'application/json' });
      const body = jsonOf(response);
      const matched = body !== undefined && UnstopDetail.safeParse(body).success;
      observations.push(observe(planned, response, matched));
      write(root, planned, body ?? response.text(), observations[observations.length - 1]!);
    }

    const verdict = r71Verdict(observations);
    process.stdout.write(
      `${JSON.stringify(
        {
          fixtures: root,
          requestsMade: client.requestsMade,
          requestLog: log,
          r71: verdict,
        },
        null,
        2,
      )}\n`,
    );
    if (!verdict.holds) {
      process.stdout.write(
        'R71 does not hold as written. Report this to the architect: the ruling changes, not only the code.\n',
      );
    }
    return 0;
  } finally {
    await closeTransport();
    db.close();
    lock.release();
  }
}

process.exitCode = await main();
