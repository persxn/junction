import { readFileSync } from 'node:fs';
import path from 'node:path';

import { EventCandidate, type EventMode, type EventType } from '@compintel/contracts';

import { users, type EventRow, type SourceRecordRow, type SourceRow } from '../db/schema/index.js';
import type { Principal } from '../modules/auth/types.js';
import { uuid7 } from '../platform/ids.js';
import { createEventsModule, type EventsModule } from '../modules/events/wiring.js';
import { SourceRecordsRepository } from '../modules/sources/records.js';
import { SourcesRepository } from '../modules/sources/repository.js';
import { AuditLog } from '../platform/audit.js';
import { SettingsStore } from '../platform/settings.js';
import { fixedClock, type Clock } from '../platform/time.js';
import { processItem } from '../scraping/items.js';
import type { SourceAdapter } from '../sources/types.js';
import { openTestGeo, type TestGeo } from './ctftime.js';
import { openMigratedDatabase, type MigratedDatabase } from './database.js';
import { fixturesDir } from './golden.js';
import { insertSource, silentLogger } from './scraping.js';

/**
 * A WP-10 harness: a migrated database with the seeded sources, the real
 * events module, and an `ingest()` that goes through WP-09a's `processItem` —
 * the same per-item transaction a scrape uses — so a fixture exercises the
 * link exactly as production does.
 */

/** The scenario fixtures' compact candidate: ISO dates, flat place and team. */
export interface FixtureCandidate {
  readonly title: string;
  readonly eventType: EventType;
  readonly organizerName?: string;
  readonly mode: EventMode;
  readonly city?: string;
  readonly countryCode?: string;
  readonly startsAt?: string;
  readonly endsAt?: string;
  readonly registrationDeadlineAt?: string;
  readonly teamMin?: number;
  readonly teamMax?: number;
  readonly officialUrl?: string;
  readonly registrationUrl?: string;
  readonly editionYear?: number;
}

export interface ScenarioRecord {
  readonly sourceKey: string;
  readonly externalKey: string;
  readonly candidate: FixtureCandidate;
}

export interface Scenario {
  readonly scenario: string;
  readonly sources: readonly { key: string; trustRank: number; adapter: SourceRow['adapter'] }[];
  readonly records: readonly ScenarioRecord[];
}

export function loadScenario(name: string): Scenario {
  return JSON.parse(
    readFileSync(path.join(fixturesDir(), 'dedup', `${name}.json`), 'utf8'),
  ) as Scenario;
}

function date(
  iso: string | undefined,
): { at: number; precision: 'DATETIME'; confidence: number } | undefined {
  return iso === undefined
    ? undefined
    : { at: Date.parse(iso), precision: 'DATETIME', confidence: 1 };
}

/** A compact fixture candidate as a validated `EventCandidate`. */
export function toCandidate(
  sourceKey: string,
  externalKey: string,
  fixture: FixtureCandidate,
): EventCandidate {
  const place =
    fixture.city === undefined && fixture.countryCode === undefined
      ? undefined
      : {
          ...(fixture.city === undefined ? {} : { city: fixture.city }),
          ...(fixture.countryCode === undefined ? {} : { countryCode: fixture.countryCode }),
        };
  const team =
    fixture.teamMin === undefined && fixture.teamMax === undefined
      ? undefined
      : {
          ...(fixture.teamMin === undefined ? {} : { min: fixture.teamMin }),
          ...(fixture.teamMax === undefined ? {} : { max: fixture.teamMax }),
          confidence: 1,
        };
  const optional = <V>(key: string, value: V | undefined): Record<string, V> =>
    value === undefined ? {} : { [key]: value };
  return EventCandidate.parse({
    sourceKey,
    externalKey,
    url: `https://${sourceKey}.example.test/events/${externalKey}`,
    title: fixture.title,
    titleRaw: fixture.title,
    eventType: { value: fixture.eventType, confidence: 1 },
    mode: { value: fixture.mode, confidence: 1 },
    isRecurringRound: false,
    warnings: [],
    ...optional('organizerName', fixture.organizerName),
    ...optional('place', place),
    ...optional('startsAt', date(fixture.startsAt)),
    ...optional('endsAt', date(fixture.endsAt)),
    ...optional('registrationDeadlineAt', date(fixture.registrationDeadlineAt)),
    ...optional('teamSize', team),
    ...optional('officialUrl', fixture.officialUrl),
    ...optional('registrationUrl', fixture.registrationUrl),
    ...optional('editionYear', fixture.editionYear),
  });
}

/** An adapter whose items already are candidates; only `normalize` is used. */
const passThrough: SourceAdapter = {
  key: 'fixture',
  displayName: 'Fixture',
  kind: 'CONFIGURED_LISTING',
  needsBrowser: false,
  defaultCadenceMinutes: 30,
  listing: () => {
    throw new Error('not used');
  },
  normalize: (input) => ('externalKey' in input ? input.payload : input.payload) as EventCandidate,
};

/**
 * One candidate through `processItem` into any database with an events module
 * — the route tests use it on the setup server's database.
 */
export function ingestInto(options: {
  readonly records: SourceRecordsRepository;
  readonly source: SourceRow;
  readonly linker: EventsModule['linker'];
  readonly candidate: EventCandidate;
  readonly at: number;
}): SourceRecordRow {
  const clock = fixedClock(new Date(options.at).toISOString());
  const result = processItem(
    {
      externalKey: options.candidate.externalKey,
      url: options.candidate.url,
      payload: options.candidate,
    },
    {
      source: options.source,
      adapter: passThrough,
      context: {
        http: undefined as never,
        log: silentLogger,
        clock,
        now: () => clock.now(),
        signal: new AbortController().signal,
        config: {},
      },
      normalizeContext: { clock, sourceKey: options.source.key, defaultTimeZone: 'UTC' },
      records: options.records,
      snapshots: undefined,
      logger: silentLogger,
      at: options.at,
      detailPending: () => false,
      linker: options.linker,
    },
  );
  if (result.outcome === 'INVALID') {
    throw new Error(`${options.source.key}/${options.candidate.externalKey} was counted invalid`);
  }
  return options.records.find(options.source.id, options.candidate.externalKey)!;
}

export interface EventsHarness {
  readonly database: MigratedDatabase;
  readonly module: EventsModule;
  readonly settings: SettingsStore;
  readonly audit: AuditLog;
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly clock: Clock & { set(iso: string): void };
  /** A stored user acting with the given role — `decided_by` and `changed_by` are real FKs. */
  user(role: 'ADMINISTRATOR' | 'PROFESSOR'): Principal;
  /** Adds a source unless the migrations seeded it. */
  source(key: string, trustRank?: number, adapter?: SourceRow['adapter']): SourceRow;
  /** One item through `processItem`, as a scrape would store it. */
  ingest(sourceKey: string, candidate: EventCandidate): SourceRecordRow;
  /** Every record of a scenario, in order. */
  ingestScenario(scenario: Scenario): SourceRecordRow[];
  eventOf(record: SourceRecordRow): EventRow;
  record(sourceKey: string, externalKey: string): SourceRecordRow;
  close(): void;
}

export function openEventsHarness(startIso = '2026-09-01T00:00:00.000Z'): EventsHarness {
  const database = openMigratedDatabase(silentLogger, 'events');
  let now = Date.parse(startIso);
  const clock = {
    now: () => new Date(now),
    set: (iso: string) => {
      now = Date.parse(iso);
    },
  };
  const settings = new SettingsStore(database.db, { clock });
  const audit = new AuditLog(database.db, { clock });
  const geo: TestGeo = openTestGeo();
  const module = createEventsModule({
    db: database.db,
    geocoder: geo.geocoder,
    settings,
    audit,
    logger: silentLogger,
    clock,
  });
  const sources = new SourcesRepository(database.db);
  const records = new SourceRecordsRepository(database.db);

  const source = (
    key: string,
    trustRank = 50,
    adapter: SourceRow['adapter'] = 'CONFIGURED_LISTING',
  ): SourceRow =>
    sources.findByKey(key) ?? insertSource(database.db, { key, name: key, trustRank, adapter });

  const ingest = (sourceKey: string, candidate: EventCandidate): SourceRecordRow =>
    ingestInto({ records, source: source(sourceKey), linker: module.linker, candidate, at: now });

  const user = (role: 'ADMINISTRATOR' | 'PROFESSOR'): Principal => {
    const id = uuid7();
    const email = `${role.toLowerCase()}-${id.slice(-6)}@example.edu`;
    database.db.drizzle
      .insert(users)
      .values({
        id,
        email,
        displayName: role,
        passwordHash: 'not-a-real-hash',
        createdAt: now,
        updatedAt: now,
      })
      .run();
    return {
      id,
      email,
      displayName: role,
      departmentId: null,
      status: 'ACTIVE',
      mustChangePassword: false,
      roles: [role],
    };
  };

  return {
    database,
    module,
    settings,
    audit,
    sources,
    records,
    clock,
    user,
    source,
    ingest,
    ingestScenario: (scenario) => {
      for (const extra of scenario.sources) {
        source(extra.key, extra.trustRank, extra.adapter);
      }
      return scenario.records.map((entry) =>
        ingest(entry.sourceKey, toCandidate(entry.sourceKey, entry.externalKey, entry.candidate)),
      );
    },
    eventOf: (record) => {
      const fresh = records.find(record.sourceId, record.externalKey);
      const event = fresh?.eventId == null ? undefined : module.events.getById(fresh.eventId);
      if (event === undefined) {
        throw new Error(`${record.externalKey} is not linked`);
      }
      return event;
    },
    record: (sourceKey, externalKey) => {
      const found = records.find(source(sourceKey).id, externalKey);
      if (found === undefined) {
        throw new Error(`no record ${sourceKey}/${externalKey}`);
      }
      return found;
    },
    close: () => {
      geo.close();
      database.close();
    },
  };
}

/** Row counts of every table, for R66's "nothing deleted" comparisons. */
export function tableCounts(database: MigratedDatabase): Record<string, number> {
  const tables = database.db.raw
    .prepare("select name from sqlite_master where type = 'table' and name not like 'sqlite_%'")
    .all() as { name: string }[];
  const counts: Record<string, number> = {};
  for (const { name } of tables) {
    counts[name] = (
      database.db.raw.prepare(`select count(*) as n from "${name}"`).get() as { n: number }
    ).n;
  }
  return counts;
}
