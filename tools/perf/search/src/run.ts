import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { cpus, homedir, totalmem } from 'node:os';
import path from 'node:path';

import {
  applyCategorySeed,
  AuditLog,
  createCategoriesModule,
  createSearchModule,
  ensureDataDirs,
  EventsRepository,
  fixedClock,
  loadCategorySeed,
  loadConfig,
  openDatabase,
  runMigrations,
  schema,
} from '@compintel/backend';
import { pino } from 'pino';

import { CORPUS_EPOCH, corpusHash, generateCorpus } from './corpus.js';
import { Prng } from './prng.js';
import { idOf, seed } from './seed.js';
import {
  DETAIL_BUDGET_MS,
  FACETS_BUDGET_MS,
  QUERY_BUDGET_MS,
  scenarios,
  timed,
} from './scenarios.js';

/**
 * `pnpm perf:search` — §8.3's budgets on 20 000 synthetic events.
 *
 * Deliberately **outside `pnpm verify`** (§4.15 budgets verify at < 2 min,
 * R19's reasoning): it seeds a throwaway database under
 * `%LOCALAPPDATA%\CompIntel-dev\test-tmp`, warms up 20 iterations, measures 200
 * per scenario, prints p50/p95/p99 and the machine, and exits non-zero when a
 * p95 misses the §8.3 budget *halved* for this build machine (Ryzen 7 5700 /
 * 16 GB): filter + text < 50 ms, facets < 75 ms, event detail < 25 ms. The 8 GB
 * numbers are WP-31/32's to measure.
 *
 * WP-15b: the corpus is classified by the starter taxonomy and the actor has
 * two interests, so ranking's category subqueries run as they would for a real
 * professor. The query scenarios ask for `facets: false` (ranking only, like
 * for like with WP-15a); the facets scenario is a full first-page request —
 * results, reasons *and* facets — so its number is what the UI waits for.
 */

const WARMUP = 20;
const ITERATIONS = 200;

const CAMPUS = { lat: 10.7905, lon: 78.7047 }; // Tiruchirappalli
const silent = pino({ enabled: false });

function devTempRoot(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev', 'test-tmp');
}

function percentile(sorted: readonly number[], p: number): number {
  return sorted[Math.min(sorted.length - 1, Math.ceil(p * sorted.length) - 1)] ?? Number.NaN;
}

async function main(): Promise<number> {
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
    const visible = seed(db, corpus, CAMPUS);
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
    const audit = new AuditLog(db, { clock });
    const categories = createCategoriesModule({ db, audit, clock });
    const seedFile = path.resolve(
      import.meta.dirname,
      '..',
      '..',
      '..',
      '..',
      'resources',
      'category-rules.seed.json',
    );
    applyCategorySeed(db, loadCategorySeed(seedFile), CORPUS_EPOCH);
    const classifyStart = performance.now();
    categories.classifier.requestReclassification('perf', null);
    const classified = await categories.classifier.processPending();
    const classifyMs = performance.now() - classifyStart;
    const assignments = (
      db.raw.prepare('select count(*) as n from event_categories').get() as { n: number }
    ).n;
    for (const [index, name] of ['AI/ML', 'Cybersecurity/CTF'].entries()) {
      const tagId = idOf(5, index + 1);
      db.raw
        .prepare(
          "insert into tags (id, kind, name, normalized, created_at) values (?, 'INTEREST', ?, ?, ?)",
        )
        .run(tagId, name, name.toLowerCase(), CORPUS_EPOCH);
      db.raw
        .prepare('insert into user_interest_tags (user_id, tag_id) values (?, ?)')
        .run(actorId, tagId);
    }
    const search = createSearchModule({
      db,
      audit,
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
      `classify: ${String(classified.events)} events → ${String(assignments)} category rows in ${classifyMs.toFixed(0)} ms (chunks of 250, one transaction each)`,
    );
    console.log(
      `budgets : §8.3 halved for this build machine — query p95 < ${String(QUERY_BUDGET_MS)} ms, facets p95 < ${String(FACETS_BUDGET_MS)} ms, detail p95 < ${String(DETAIL_BUDGET_MS)} ms`,
    );
    console.log('');
    console.log('scenario             p50 ms   p95 ms   p99 ms   budget   result');

    let failed = false;
    for (const scenario of scenarios(search, { id: actorId, roles: ['PROFESSOR'] }, visible)) {
      const rng = new Prng(7);
      for (let i = 0; i < WARMUP; i += 1) timed(scenario, rng);
      const samples: number[] = [];
      for (let i = 0; i < ITERATIONS; i += 1) samples.push(timed(scenario, rng));
      samples.sort((a, b) => a - b);
      const p95 = percentile(samples, 0.95);
      const ok = scenario.budgetMs === undefined || p95 < scenario.budgetMs;
      failed ||= !ok;
      console.log(
        `${scenario.name.padEnd(20)} ${percentile(samples, 0.5).toFixed(2).padStart(6)}   ${p95.toFixed(2).padStart(6)}   ${percentile(samples, 0.99).toFixed(2).padStart(6)}   ${scenario.budgetMs === undefined ? '    —' : `< ${String(scenario.budgetMs).padStart(3)}`}    ${scenario.budgetMs === undefined ? 'INFO' : ok ? 'PASS' : 'FAIL'}`,
      );
    }
    return failed ? 1 : 0;
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

process.exitCode = await main();
