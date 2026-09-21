import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';

import {
  applyCategorySeed,
  AuditLog,
  createCategoriesModule,
  ensureDataDirs,
  loadCategorySeed,
  loadConfig,
  openDatabase,
  runMigrations,
} from '@compintel/backend';
import { pino } from 'pino';

import { CORPUS_EPOCH, generateCorpus, type CorpusEvent } from './corpus.js';
import { seed } from './seed.js';

/**
 * `pnpm seed:demo` — a small, deterministic demo database for the WP-16a E2E
 * and for looking at Discover by hand.
 *
 *   pnpm seed:demo [--data-dir <dir>] [--events 300]
 *
 * It reuses WP-15a's corpus generator (the first N events of the same seeded
 * sequence), shifted so "today" in the corpus is today on the clock, and
 * classified by the starter taxonomy. Three things it guarantees:
 *
 * - the directory is under `%LOCALAPPDATA%\CompIntel-dev` (CLAUDE.md: dev data
 *   never lives in the repository), and must not already hold a database;
 * - **every source is switched off**, so a backend started on it registers no
 *   scrape job and contacts no event website — ever;
 * - setup is *not* done here: the E2E completes the real wizard over HTTP, which
 *   creates the organization, the campus and the account it signs in with.
 */

const silent = pino({ enabled: false });

function devRoot(): string {
  const base = process.env.LOCALAPPDATA ?? path.join(homedir(), 'AppData', 'Local');
  return path.join(base, 'CompIntel-dev');
}

function shifted(event: CorpusEvent, delta: number): CorpusEvent {
  const move = (at: number | null): number | null => (at === null ? null : at + delta);
  return {
    ...event,
    registrationDeadlineAt: move(event.registrationDeadlineAt),
    startsAt: move(event.startsAt),
    endsAt: move(event.endsAt),
    firstSeenAt: event.firstSeenAt + delta,
  };
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    // pnpm forwards a literal `--` between script and arguments.
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: { 'data-dir': { type: 'string' }, events: { type: 'string' } },
  });
  const root = devRoot();
  const dataDir = path.resolve(values['data-dir'] ?? path.join(root, 'e2e', 'demo'));
  if (!dataDir.toLowerCase().startsWith(root.toLowerCase() + path.sep)) {
    console.error(`seed:demo writes only under ${root}; refusing ${dataDir}.`);
    return 2;
  }
  if (existsSync(path.join(dataDir, 'data', 'app.db'))) {
    console.error(`${dataDir} already holds a database; pass a fresh --data-dir.`);
    return 2;
  }
  const count = Number(values.events ?? '300');
  if (!Number.isInteger(count) || count < 1 || count > 5_000) {
    console.error('--events is 1–5000 (the E2E needs a few hundred, not 20 000).');
    return 2;
  }

  mkdirSync(dataDir, { recursive: true });
  const config = loadConfig({
    argv: ['--data-dir', dataDir],
    env: { COMPINTEL_CLIENT_SECRET: '0'.repeat(32) },
  });
  ensureDataDirs(config);
  const db = openDatabase(config, { logger: silent });
  try {
    const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..');
    runMigrations(config, db, {
      migrationsDir: path.join(repo, 'apps', 'backend', 'migrations'),
      logger: silent,
    });
    const now = Date.now();
    const corpus = generateCorpus(count).map((event) => shifted(event, now - CORPUS_EPOCH));
    const visible = seed(db, corpus, undefined);
    const switchedOff = db.raw.prepare('UPDATE sources SET is_enabled = 0').run().changes;

    const audit = new AuditLog(db);
    const categories = createCategoriesModule({ db, audit });
    applyCategorySeed(
      db,
      loadCategorySeed(path.join(repo, 'resources', 'category-rules.seed.json')),
      now,
    );
    categories.classifier.requestReclassification('seed:demo', null);
    const classified = await categories.classifier.processPending();

    console.log(
      JSON.stringify({
        dataDir,
        events: corpus.length,
        visible: visible.length,
        classified: classified.events,
        sourcesSwitchedOff: switchedOff,
      }),
    );
    return 0;
  } finally {
    db.close();
  }
}

process.exitCode = await main();
