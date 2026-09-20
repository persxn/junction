import { afterEach, describe, expect, it } from 'vitest';

import { openMigratedDatabase, type MigratedDatabase } from '../../testing/database.js';
import { SetupRepository, type SetupWrite } from './repository.js';

/**
 * Ruling R40: setup is one transaction. The interesting case is the one nobody
 * ever sees — a failure part way through — because the alternative to a rollback
 * is an installation with an organization and no administrator, which the R39
 * gate would then lock everyone out of for ever.
 */

let database: MigratedDatabase | undefined;

afterEach(() => {
  database?.close();
  database = undefined;
});

function open(): { repository: SetupRepository; db: MigratedDatabase } {
  database = openMigratedDatabase(undefined, 'setup-repo');
  return { repository: new SetupRepository(database.db), db: database };
}

function write(settings: SetupWrite['settings'] = []): SetupWrite {
  return {
    organization: { name: 'Example Institute of Technology', shortName: 'EIT' },
    department: { name: 'Computer Science and Engineering', code: 'CSE' },
    campus: { name: 'Main Campus', lat: 10.7594, lon: 78.8149 },
    admin: {
      email: 'admin@example.edu',
      displayName: 'A. Administrator',
      passwordHash: '$argon2id$pretend',
    },
    settings,
  };
}

function counts(db: MigratedDatabase): Record<string, number> {
  const count = (table: string): number =>
    (db.db.raw.prepare(`select count(*) as n from ${table}`).get() as { n: number }).n;
  return {
    organizations: count('organizations'),
    departments: count('departments'),
    campuses: count('campuses'),
    users: count('users'),
    userRoles: count('user_roles'),
    settings: count('settings'),
  };
}

describe('completeSetup', () => {
  it('writes the whole installation at once', () => {
    const { repository, db } = open();
    const result = repository.completeSetup(write([['auth.autoLockMinutes', '15']]));

    expect(counts(db)).toStrictEqual({
      organizations: 1,
      departments: 1,
      campuses: 1,
      users: 1,
      userRoles: 2,
      settings: 1,
    });
    expect(result.adminUserId).toMatch(/^[0-9a-f-]{36}$/);
    expect(repository.hasActiveAdministrator()).toBe(true);
    expect(repository.organization()?.name).toBe('Example Institute of Technology');
  });

  it('rolls everything back when the last write fails (R40)', () => {
    const { repository, db } = open();

    // A settings row with no key. Every other insert has already happened by
    // the time SQLite refuses this one, so only a real transaction saves us.
    expect(() =>
      repository.completeSetup(write([[null as unknown as string, '"anything"']])),
    ).toThrow();

    expect(counts(db)).toStrictEqual({
      organizations: 0,
      departments: 0,
      campuses: 0,
      users: 0,
      userRoles: 0,
      settings: 0,
    });
    // And the gate is still shut, so the user simply tries again.
    expect(repository.hasActiveAdministrator()).toBe(false);
    expect(repository.organization()).toBeUndefined();
  });

  it('rolls back a campus the CHECK constraints refuse', () => {
    const { repository, db } = open();
    expect(() =>
      repository.completeSetup({
        ...write(),
        campus: { name: 'Off the map', lat: 91, lon: 0 },
      }),
    ).toThrow();
    expect(counts(db).organizations).toBe(0);
  });

  it('does not count a DISABLED administrator as one', () => {
    const { repository, db } = open();
    repository.completeSetup(write());
    expect(repository.hasActiveAdministrator()).toBe(true);

    db.db.raw.prepare("update users set status = 'DISABLED'").run();
    expect(repository.hasActiveAdministrator()).toBe(false);
  });

  it('reports the schema version the migrations reached', () => {
    const { repository, db } = open();
    expect(repository.schemaVersion()).toBe(db.migrations);
  });
});
