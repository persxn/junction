import type { Principal } from '../auth/types.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../../platform/audit.js';
import { AdapterRegistry } from '../../sources/registry.js';
import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { codeOf, failure } from '../../testing/auth.js';
import {
  fakeTransport,
  insertSource,
  listingItem,
  movableClock,
  silentLogger,
  testAdapter,
  testScrapingHttp,
} from '../../testing/scraping.js';
import { users } from '../../db/schema/index.js';
import { SourceRecordsRepository } from './records.js';
import { SourcesRepository } from './repository.js';
import { SourcesService } from './service.js';

/**
 * `SourcesService` at the service level: the manual floor, the run path shared
 * with the scheduler, and the two reads Source status is built from.
 *
 * The HTTP layer has its own suite; this one exists for the cases a route test
 * cannot reach, above all "a manual refresh with an adapter actually registered"
 * — which in WP-09a only a test can arrange, since the registry ships empty.
 */

const ROBOTS = 'https://example.test/robots.txt';
const ROBOTS_ALLOW_ALL = 'User-agent: *\nDisallow:\n';

const ADMIN: Principal = {
  id: 'admin-1',
  email: 'admin@example.edu',
  displayName: 'A. Administrator',
  departmentId: null,
  status: 'ACTIVE',
  mustChangePassword: false,
  roles: ['ADMINISTRATOR'],
};

const PROFESSOR: Principal = { ...ADMIN, id: 'prof-1', roles: ['PROFESSOR'] };

let database: MigratedDatabase;
let clock: ReturnType<typeof movableClock>;
let registry: AdapterRegistry;
let service: SourcesService;

/** `audit_log.actor_user_id` is a real foreign key, so the actors must exist. */
function seedActors(): void {
  for (const actor of [ADMIN, PROFESSOR]) {
    database.db.drizzle
      .insert(users)
      .values({
        id: actor.id,
        email: `${actor.id}@example.edu`,
        displayName: actor.displayName,
        passwordHash: 'not-a-real-hash',
        createdAt: clock.now().getTime(),
        updatedAt: clock.now().getTime(),
      })
      .run();
  }
}

beforeEach(() => {
  database = openMigratedDatabase(silentLogger, 'sources-service');
  clock = movableClock('2026-09-21T10:00:00.000Z');
  seedActors();
  registry = new AdapterRegistry();
  service = new SourcesService({
    sources: new SourcesRepository(database.db),
    records: new SourceRecordsRepository(database.db),
    registry,
    audit: new AuditLog(database.db, { clock }),
    logger: silentLogger,
    clock,
    runtime: {
      http: testScrapingHttp({
        transport: fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } }),
        clock,
      }),
      setupComplete: () => true,
    },
  });
});

afterEach(() => {
  database.close();
});

describe('reads', () => {
  it('lists the seeded sources without their configuration', () => {
    const list = service.list();
    expect(list).toHaveLength(7);
    expect(JSON.stringify(list)).not.toContain('apiKeySetting');
  });

  it('reports a source that has never run as having no freshness', () => {
    const status = service.statusOf('ctftime');
    expect(status.lastRunAt).toBeNull();
    expect(status.lastSuccessAt).toBeNull();
    expect(status.freshnessMinutes).toBeNull();
    expect(status.lastOutcome).toBeNull();
  });

  it('answers SOURCE_NOT_FOUND for a key nobody seeded', () => {
    expect(() => service.statusOf('nosuch')).toThrow(/no source/i);
  });
});

describe('the manual floor (D-27)', () => {
  it('refuses a refresh inside the floor and names when it will be allowed', async () => {
    const source = insertSource(database.db, { key: 'demo', manualMinIntervalMinutes: 10 });
    registry.register(testAdapter({ key: 'demo', items: [listingItem('a')] }));

    const first = await service.refresh({ actor: ADMIN }, 'demo');
    expect(first.run.outcome).toBe('SUCCESS');

    clock.advance(9 * 60_000);
    const refused = await failure(service.refresh({ actor: ADMIN }, 'demo'));
    expect(codeOf(refused)).toBe('SOURCE_REFRESH_TOO_SOON');
    expect(refused.status).toBe(429);
    // Nothing was attempted, so the run history is untouched.
    expect(new SourcesRepository(database.db).runs(source.id)).toHaveLength(1);

    clock.advance(2 * 60_000);
    const allowed = await service.refresh({ actor: ADMIN }, 'demo');
    expect(allowed.run.outcome).toBe('SUCCESS');
    expect(allowed.run.trigger).toBe('MANUAL');
  });

  it('measures the floor from the last run of any kind, not the last manual one', async () => {
    const source = insertSource(database.db, { key: 'demo', manualMinIntervalMinutes: 10 });
    registry.register(testAdapter({ key: 'demo', items: [listingItem('a')] }));
    await service.run(source, 'SCHEDULE');

    clock.advance(60_000);
    expect(codeOf(await failure(service.refresh({ actor: ADMIN }, 'demo')))).toBe(
      'SOURCE_REFRESH_TOO_SOON',
    );
  });

  it('refuses a professor before it looks at the clock (§10.2)', async () => {
    insertSource(database.db, { key: 'demo' });
    registry.register(testAdapter({ key: 'demo' }));
    expect(codeOf(await failure(service.refresh({ actor: PROFESSOR }, 'demo')))).toBe('FORBIDDEN');
  });
});

describe('runnable sources (R22)', () => {
  it('is empty while the registry is', () => {
    expect(service.runnable()).toEqual([]);
  });

  it('includes only enabled, approved sources with an adapter', () => {
    insertSource(database.db, { key: 'yes' });
    insertSource(database.db, { key: 'off', isEnabled: false });
    insertSource(database.db, { key: 'unapproved', complianceStatus: 'PENDING_REVIEW' });
    insertSource(database.db, { key: 'no-adapter' });
    for (const key of ['yes', 'off', 'unapproved']) {
      registry.register(testAdapter({ key }));
    }
    expect(service.runnable().map((source) => source.key)).toEqual(['yes']);
  });
});

describe('a 304 listing (§7.2, R58)', () => {
  it('counts every listed record as unchanged and does not age any of them out', async () => {
    const source = insertSource(database.db, { key: 'demo' });
    registry.register(testAdapter({ key: 'demo', items: [listingItem('a'), listingItem('b')] }));
    const first = await service.run(source, 'SCHEDULE');
    expect(first.itemsNew).toBe(2);

    // Three complete runs that answered 304. A run that reported "complete walk,
    // zero items" would have marked both records MISSING by the third.
    const records = new SourceRecordsRepository(database.db);
    registry.register(testAdapter({ key: 'notmodified' }));
    for (let index = 0; index < 3; index += 1) {
      clock.advance(30 * 60_000);
      const unchanged = await runNotModified(source);
      expect(unchanged.outcome).toBe('SUCCESS');
      expect(unchanged.itemsUnchanged).toBe(2);
      expect(unchanged.itemsSeen).toBe(2);
      expect(unchanged.itemsNew).toBe(0);
    }
    expect(records.find(source.id, 'a')?.presence).toBe('LISTED');
    expect(records.find(source.id, 'b')?.presence).toBe('LISTED');
  });

  /** A run whose adapter reports a 304 without yielding anything. */
  async function runNotModified(
    source: ReturnType<typeof insertSource>,
  ): Promise<{ outcome: string; itemsUnchanged: number; itemsSeen: number; itemsNew: number }> {
    const inner = new SourcesService({
      sources: new SourcesRepository(database.db),
      records: new SourceRecordsRepository(database.db),
      registry: standalone(),
      audit: new AuditLog(database.db, { clock }),
      logger: silentLogger,
      clock,
      runtime: {
        http: testScrapingHttp({
          transport: fakeTransport({ [ROBOTS]: { body: ROBOTS_ALLOW_ALL } }),
          clock,
        }),
        setupComplete: () => true,
      },
    });
    return inner.run(source, 'SCHEDULE');
  }

  function standalone(): AdapterRegistry {
    const local = new AdapterRegistry();
    local.register(testAdapter({ key: 'demo', items: [], complete: true, notModified: true }));
    return local;
  }
});

describe('running without an adapter', () => {
  it('is a 409 rather than a failed run that starts a backoff ladder', async () => {
    const source = insertSource(database.db, { key: 'demo' });
    const error = await failure(Promise.resolve().then(() => service.run(source, 'SCHEDULE')));
    expect(error.status).toBe(409);
    expect(new SourcesRepository(database.db).runs(source.id)).toHaveLength(0);
    expect(
      new SourcesRepository(database.db).state(source.id, clock.now().getTime())
        .consecutiveFailures,
    ).toBe(0);
  });
});

describe('administration', () => {
  it('bumps the version and audits every change', () => {
    const source = insertSource(database.db, { key: 'demo' });
    const updated = service.update({ actor: ADMIN }, 'demo', {
      cadenceMinutes: 45,
      version: source.version,
    });
    expect(updated).toMatchObject({ cadenceMinutes: 45, version: source.version + 1 });
    const audit = new AuditLog(database.db, { clock });
    expect(audit.all().map((row) => row.action)).toContain('source.updated');
  });

  it('refuses a professor', () => {
    insertSource(database.db, { key: 'demo' });
    expect(() => service.update({ actor: PROFESSOR }, 'demo', { version: 1 })).toThrow();
  });

  it('never writes compliance_status, whatever it is handed', () => {
    const source = insertSource(database.db, {
      key: 'demo',
      complianceStatus: 'MANUAL_IMPORT_ONLY',
    });
    service.update({ actor: ADMIN }, 'demo', {
      ...({ complianceStatus: 'APPROVED' } as object),
      version: source.version,
    });
    expect(service.byKey('demo')?.complianceStatus).toBe('MANUAL_IMPORT_ONLY');
  });
});
