import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, homedir, totalmem } from 'node:os';
import path from 'node:path';

import {
  AuditLog,
  createSearchModule,
  ensureDataDirs,
  EventsRepository,
  fixedClock,
  loadConfig,
  openDatabase,
  runMigrations,
  schema,
  type SearchModule,
} from '@compintel/backend';
import type { EventQueryInput } from '@compintel/contracts';
import { pino } from 'pino';

import { CORPUS_EPOCH, corpusHash, generateCorpus, type CorpusEvent } from './corpus.js';
import { Prng } from './prng.js';

/**
 * `pnpm perf:search` — §8.3's budgets on 20 000 synthetic events.
 *
 * Deliberately **outside `pnpm verify`** (§4.15 budgets verify at < 2 min,
 * R19's reasoning): it seeds a throwaway database under
 * `%LOCALAPPDATA%\CompIntel-dev\test-tmp`, warms up 20 iterations, measures 200
 * per scenario, prints p50/p95/p99 and the machine, and exits non-zero when a
 * p95 misses the §8.3 budget *halved* for this build machine (Ryzen 7 5700 /
 * 16 GB): filter + text < 50 ms, event detail < 25 ms. The 8 GB numbers are
 * WP-31/32's to measure.
 */

const WARMUP = 20;
const ITERATIONS = 200;
/** §8.3 halved: 100 → 50 ms for queries, 50 → 25 ms for detail. */
const QUERY_BUDGET_MS = 50;
const DETAIL_BUDGET_MS = 25;
const CAMPUS = { lat: 10.7905, lon: 78.7047 }; // Tiruchirappalli
const silent = pino({ enabled: false });

function devTempRoot(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev', 'test-tmp');
}

/** A UUIDv7-shaped id derived from the row index, so the database is reproducible too. */
const idOf = (prefix: number, index: number): string =>
  `0192${prefix.toString(16).padStart(4, '0')}-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;

function seed(db: ReturnType<typeof openDatabase>, corpus: readonly CorpusEvent[]): string[] {
  const organizationId = idOf(1, 1);
  db.drizzle
    .insert(schema.organizations)
    .values({
      id: organizationId,
      name: 'Perf Institute',
      createdAt: CORPUS_EPOCH,
      updatedAt: CORPUS_EPOCH,
    })
    .run();
  db.drizzle
    .insert(schema.campuses)
    .values({
      id: idOf(1, 2),
      organizationId,
      name: 'Main',
      ...CAMPUS,
      isPrimary: true,
      createdAt: CORPUS_EPOCH,
      updatedAt: CORPUS_EPOCH,
    })
    .run();
  const sources = new Map(
    db.drizzle
      .select({ id: schema.sources.id, key: schema.sources.key })
      .from(schema.sources)
      .all()
      .map((row) => [row.key, row.id]),
  );
  const visible: string[] = [];
  db.raw.transaction(() => {
    for (let at = 0; at < corpus.length; at += 250) {
      const batch = corpus.slice(at, at + 250);
      db.drizzle
        .insert(schema.events)
        .values(
          batch.map((event) => ({
            id: idOf(2, event.index),
            title: event.title,
            normalizedTitle: event.title.toLowerCase(),
            eventType: event.eventType as never,
            isRecurringRound: event.isRecurringRound,
            organizerName: event.organizerName,
            organizerKind: event.organizerKind as never,
            descriptionMd: event.descriptionMd,
            mode: event.mode,
            city: event.city,
            countryCode: event.city === null ? null : 'IN',
            lat: event.lat,
            lon: event.lon,
            geoPrecision: event.geoPrecision,
            registrationDeadlineAt: event.registrationDeadlineAt,
            registrationDeadlinePrecision:
              event.registrationDeadlineAt === null ? 'UNKNOWN' : 'DATE',
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            datePrecision: event.startsAt === null ? 'UNKNOWN' : 'DATE',
            teamMin: event.teamMin,
            teamMax: event.teamMax,
            feeKnown: event.feeKnown,
            feeMinor: event.feeMinor,
            feeCurrency: event.feeKnown ? 'INR' : null,
            prizeTotalMinor: event.prizeTotalMinor,
            prizeCurrency: event.prizeTotalMinor === null ? null : 'INR',
            visibility: event.visibility,
            policyReason: event.visibility === 'POLICY_HIDDEN' ? 'EVENT_TYPE_NOT_ALLOWED' : null,
            qualityScore: 60,
            firstSeenAt: event.firstSeenAt,
            lastChangedAt: event.firstSeenAt,
            createdAt: event.firstSeenAt,
            updatedAt: event.firstSeenAt,
          })) as (typeof schema.events.$inferInsert)[],
        )
        .run();
      db.drizzle
        .insert(schema.sourceRecords)
        .values(
          batch.map((event) => ({
            id: idOf(3, event.index),
            sourceId: sources.get(event.sourceKey) ?? '',
            externalKey: `perf-${String(event.index)}`,
            url: `https://${event.sourceKey}.example.test/${String(event.index)}`,
            firstSeenAt: event.firstSeenAt,
            lastSeenAt: CORPUS_EPOCH,
            lastFetchedAt: CORPUS_EPOCH,
            contentHash: String(event.index),
            payloadJson: '{}',
            eventId: idOf(2, event.index),
            originEventId: idOf(2, event.index),
          })),
        )
        .run();
      for (const event of batch) {
        if (event.visibility === 'VISIBLE') visible.push(idOf(2, event.index));
      }
    }
  })();
  return visible;
}

interface Scenario {
  readonly name: string;
  readonly budgetMs: number | undefined;
  readonly run: (rng: Prng) => void;
}

function scenarios(
  search: SearchModule,
  actor: { id: string; roles: ['PROFESSOR'] },
  visible: readonly string[],
): Scenario[] {
  const context = {
    actor: {
      ...actor,
      email: 'p@example.edu',
      displayName: 'Perf',
      departmentId: null,
      status: 'ACTIVE' as const,
      mustChangePassword: false,
    },
  };
  const texts = [
    'hackathon',
    'machine learning',
    'iit madras',
    'security challenge',
    'ml',
    'open source sprint',
    'quantum',
    'ackath',
    'hackthon',
    'cyber secuirty',
    'climate ideathon 2026',
    'nasscom',
  ];
  const types = ['HACKATHON', 'IDEATHON', 'CTF', 'CODING_CONTEST', 'INNOVATION_CHALLENGE'] as const;
  const filters = (rng: Prng): EventQueryInput => ({
    eventTypes: [rng.pick(types), rng.pick(types)],
    modes: ['OFFLINE', 'HYBRID', 'ONLINE'],
    registration: { states: ['OPEN', 'CLOSING_SOON'] },
    teamSizeFits: rng.int(1, 4),
    includeUnknown: { teamSize: true },
    ...(rng.chance(0.5)
      ? {
          feeMax: { minor: 100_000, currency: 'INR' },
          includeUnknown: { fee: true, teamSize: true },
        }
      : {}),
  });
  const query = (input: EventQueryInput): void => {
    search.service.search(context, input);
  };
  return [
    {
      name: 'filters only',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({
          ...filters(rng),
          sort: rng.pick(['DEADLINE', 'START', 'PRIZE', 'NEWEST'] as const),
        });
      },
    },
    {
      name: 'filters + text',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({ ...filters(rng), text: rng.pick(texts), sort: 'RELEVANCE' });
      },
    },
    {
      name: 'text + distance',
      budgetMs: QUERY_BUDGET_MS,
      run: (rng) => {
        query({
          text: rng.pick(texts),
          maxDistanceKm: rng.pick([50, 100, 250, 500]),
          sort: 'DISTANCE',
        });
      },
    },
    {
      name: 'detail by id',
      budgetMs: DETAIL_BUDGET_MS,
      run: (rng) => {
        search.service.detail(context, rng.pick(visible));
      },
    },
  ];
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
}

function main(): number {
  const root = devTempRoot();
  mkdirSync(root, { recursive: true });
  const dir = mkdtempSync(path.join(root, 'perf-search-'));
  const config = loadConfig({
    argv: ['--data-dir', dir],
    env: { COMPINTEL_CLIENT_SECRET: '0'.repeat(32) },
  });
  ensureDataDirs(config);
  const db = openDatabase(config, { logger: silent });
  try {
    const migrationsDir = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'apps',
      'backend',
      'migrations',
    );
    runMigrations(config, db, { migrationsDir, logger: silent });

    const corpus = generateCorpus();
    const seedStart = performance.now();
    const visible = seed(db, corpus);
    const seedMs = performance.now() - seedStart;

    const actorId = idOf(4, 1);
    db.drizzle
      .insert(schema.users)
      .values({
        id: actorId,
        email: 'perf@example.edu',
        displayName: 'Perf',
        passwordHash: 'x',
        createdAt: CORPUS_EPOCH,
        updatedAt: CORPUS_EPOCH,
      })
      .run();
    const clock = fixedClock(new Date(CORPUS_EPOCH).toISOString());
    const search = createSearchModule({
      db,
      audit: new AuditLog(db, { clock }),
      events: new EventsRepository(db),
      clock,
    });
    const vocabStart = performance.now();
    const terms = search.vocabulary.refresh();
    const vocabMs = performance.now() - vocabStart;

    const cpu = cpus()[0]?.model.trim() ?? 'unknown CPU';
    const sqlite = (db.raw.prepare('select sqlite_version() as v').get() as { v: string }).v;
    console.log(
      `machine : ${cpu} · ${String(cpus().length)} threads · ${(totalmem() / 2 ** 30).toFixed(1)} GB · node ${process.version} · SQLite ${sqlite}`,
    );
    console.log(
      `corpus  : ${String(corpus.length)} events (${String(visible.length)} visible), sha256 ${corpusHash(corpus).slice(0, 16)}…`,
    );
    console.log(
      `seeding : ${seedMs.toFixed(0)} ms incl. FTS triggers · vocabulary ${String(terms)} terms in ${vocabMs.toFixed(0)} ms`,
    );
    console.log(
      `budgets : §8.3 halved for this build machine — query p95 < ${String(QUERY_BUDGET_MS)} ms, detail p95 < ${String(DETAIL_BUDGET_MS)} ms`,
    );
    console.log('');
    console.log('scenario           p50 ms   p95 ms   p99 ms   budget   result');

    let failed = false;
    for (const scenario of scenarios(search, { id: actorId, roles: ['PROFESSOR'] }, visible)) {
      const rng = new Prng(7);
      for (let i = 0; i < WARMUP; i += 1) scenario.run(rng);
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i += 1) {
        const started = performance.now();
        scenario.run(rng);
        samples.push(performance.now() - started);
      }
      samples.sort((a, b) => a - b);
      const p95 = percentile(samples, 0.95);
      const ok = scenario.budgetMs === undefined || p95 < scenario.budgetMs;
      failed ||= !ok;
      console.log(
        `${scenario.name.padEnd(18)} ${percentile(samples, 0.5).toFixed(2).padStart(6)}   ${p95.toFixed(2).padStart(6)}   ${percentile(samples, 0.99).toFixed(2).padStart(6)}   < ${String(scenario.budgetMs).padStart(3)}    ${ok ? 'PASS' : 'FAIL'}`,
      );
    }
    console.log(`${'facets'.padEnd(18)}      —        —        —      < 75    SKIPPED (WP-15b)`);
    return failed ? 1 : 0;
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

process.exitCode = main();
