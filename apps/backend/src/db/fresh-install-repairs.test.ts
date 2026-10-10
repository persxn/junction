import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { openMigratedDatabase, type MigratedDatabase } from '../testing/database.js';

/**
 * Migration 0032 repairs what the v0.9.0 installer did to a fresh machine: the
 * gzip bug paused CTFtime and Devfolio as SCHEMA_CHANGED on their first run, and
 * both stored sign-in pages had moved. The state is rebuilt on a
 * fully migrated database and the migration's own SQL is replayed over it.
 */

const SQL = readFileSync(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    '..',
    '..',
    'migrations',
    '0032_fresh_install_repairs.sql',
  ),
  'utf8',
);

let database: MigratedDatabase | undefined;
afterEach(() => {
  database?.close();
  database = undefined;
});

interface SourceView {
  readonly key: string;
  readonly enabled: number;
  readonly loginUrl: string | null;
  readonly failures: number | null;
  readonly backoff: number | null;
}

function replay(h: MigratedDatabase): void {
  for (const statement of SQL.split('--> statement-breakpoint')) {
    h.db.raw.exec(statement);
  }
}

function view(h: MigratedDatabase, key: string): SourceView {
  return h.db.raw
    .prepare(
      `SELECT s.key, s.is_enabled AS enabled,
              json_extract(s.config_json, '$.session.loginUrl') AS loginUrl,
              st.consecutive_failures AS failures, st.backoff_until AS backoff
         FROM sources s LEFT JOIN source_state st ON st.source_id = s.id WHERE s.key = ?`,
    )
    .get(key) as SourceView;
}

function breakAsV090Did(h: MigratedDatabase, key: string, lastSuccessAt: number | null): void {
  const id = (h.db.raw.prepare('SELECT id FROM sources WHERE key = ?').get(key) as { id: string })
    .id;
  h.db.raw.prepare('UPDATE sources SET is_enabled = 0 WHERE id = ?').run(id);
  h.db.raw.prepare('DELETE FROM source_state WHERE source_id = ?').run(id);
  h.db.raw
    .prepare(
      `INSERT INTO source_state (source_id, next_due_at, consecutive_failures, backoff_until,
         last_error_kind, last_success_at) VALUES (?, ?, 1, ?, 'SCHEMA_CHANGED', ?)`,
    )
    .run(id, 1_791_626_815_209, 1_791_626_815_209, lastSuccessAt);
}

describe('migration 0032 (fresh-install repairs)', () => {
  it('re-enables the sources the gzip bug paused and points both sign-ins at their new pages', () => {
    const h = (database = openMigratedDatabase(undefined, 'repairs'));
    h.db.raw
      .prepare(
        `UPDATE sources SET config_json = json_set(config_json, '$.session.loginUrl', ?) WHERE key = 'devfolio'`,
      )
      .run('https://devfolio.co/login');
    breakAsV090Did(h, 'ctftime', null);
    breakAsV090Did(h, 'devfolio', null);

    replay(h);

    expect(view(h, 'ctftime')).toMatchObject({ enabled: 1, failures: 0, backoff: null });
    expect(view(h, 'devfolio')).toMatchObject({
      enabled: 1,
      loginUrl: 'https://devfolio.co/discover?auth=signin',
    });
    expect(view(h, 'unstop').loginUrl).toBe('https://unstop.com/auth/login');
  });

  it('leaves alone a source that once worked and was switched off since', () => {
    const h = (database = openMigratedDatabase(undefined, 'repairs-kept'));
    breakAsV090Did(h, 'ctftime', 1_791_000_000_000);
    replay(h);
    expect(view(h, 'ctftime')).toMatchObject({ enabled: 0, failures: 1 });
  });

  it('is a no-op on a healthy database, and a second run changes nothing', () => {
    const h = (database = openMigratedDatabase(undefined, 'repairs-idempotent'));
    const before = h.db.raw.prepare('SELECT key, is_enabled, version FROM sources').all();
    replay(h);
    replay(h);
    expect(h.db.raw.prepare('SELECT key, is_enabled, version FROM sources').all()).toStrictEqual(
      before,
    );
  });
});
