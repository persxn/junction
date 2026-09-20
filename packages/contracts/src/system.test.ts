import { describe, expect, it } from 'vitest';

import {
  HealthDatabase,
  HealthResponse,
  ReadyLine,
  ReadyLineFailed,
  ReadyLineOk,
  STARTUP_ERROR_CODES,
  StartupErrorCode,
} from './system.js';

const health = {
  status: 'ok',
  appVersion: '0.1.0',
  apiVersion: '1.0.0',
  startedAt: '2026-09-20T09:15:00.000Z',
  uptimeSec: 12,
  database: { ok: true, migrationsApplied: 1 },
} as const;

describe('HealthResponse', () => {
  it('accepts a healthy body', () => {
    expect(HealthResponse.parse(health)).toStrictEqual(health);
  });

  it('accepts a local time with an offset', () => {
    const local = { ...health, startedAt: '2026-09-20T14:45:00.000+05:30' };
    expect(HealthResponse.safeParse(local).success).toBe(true);
  });

  it.each(['degraded', 'OK', ''])('rejects the status %p', (status) => {
    expect(HealthResponse.safeParse({ ...health, status }).success).toBe(false);
  });

  it.each(['20 Sep 2026', '2026-09-20', ''])('rejects the startedAt %p', (startedAt) => {
    expect(HealthResponse.safeParse({ ...health, startedAt }).success).toBe(false);
  });

  it.each([-1, 1.5, '12'])('rejects the uptimeSec %p', (uptimeSec) => {
    expect(HealthResponse.safeParse({ ...health, uptimeSec }).success).toBe(false);
  });

  it.each(['appVersion', 'apiVersion', 'startedAt', 'uptimeSec', 'status', 'database'] as const)(
    'requires %s',
    (field) => {
      const { [field]: _omitted, ...rest } = health;
      expect(HealthResponse.safeParse(rest).success).toBe(false);
    },
  );
});

describe('HealthDatabase', () => {
  it('accepts a healthy database section', () => {
    expect(HealthDatabase.parse({ ok: true, migrationsApplied: 3 })).toStrictEqual({
      ok: true,
      migrationsApplied: 3,
    });
  });

  it('accepts a database that is not ok', () => {
    expect(HealthDatabase.safeParse({ ok: false, migrationsApplied: 0 }).success).toBe(true);
  });

  it.each([-1, 1.5, '3', null])('rejects the migrationsApplied %p', (migrationsApplied) => {
    expect(HealthDatabase.safeParse({ ok: true, migrationsApplied }).success).toBe(false);
  });

  it('rejects a non-boolean ok', () => {
    expect(HealthDatabase.safeParse({ ok: 'yes', migrationsApplied: 0 }).success).toBe(false);
  });
});

describe('StartupErrorCode', () => {
  it('holds exactly the codes main.ts can emit', () => {
    expect([...STARTUP_ERROR_CODES]).toStrictEqual([
      'CONFIG_INVALID',
      'DATA_DIR_UNUSABLE',
      'DATA_DIR_LOCKED',
      'DB_OPEN_FAILED',
      'DB_CORRUPT',
      'MIGRATION_FAILED',
      'LISTEN_FAILED',
      'STARTUP_FAILED',
    ]);
  });

  it('rejects an unknown code', () => {
    expect(StartupErrorCode.safeParse('BOOM').success).toBe(false);
  });
});

describe('ReadyLine', () => {
  const ok = {
    ready: true,
    port: 51234,
    pid: 4242,
    appVersion: '0.1.0',
    apiVersion: '1.0.0',
  } as const;
  const failed = {
    ready: false,
    error: { code: 'CONFIG_INVALID', message: '--data-dir is required' },
  } as const;

  it('accepts the success line', () => {
    expect(ReadyLine.parse(ok)).toStrictEqual(ok);
    expect(ReadyLineOk.parse(ok)).toStrictEqual(ok);
  });

  it('accepts the failed-start line', () => {
    expect(ReadyLine.parse(failed)).toStrictEqual(failed);
    expect(ReadyLineFailed.parse(failed)).toStrictEqual(failed);
  });

  it('discriminates on ready', () => {
    const parsed = ReadyLine.parse(ok);
    expect(parsed.ready ? parsed.port : null).toBe(51234);
  });

  it.each([0, 65536, 1.5, '51234'])('rejects the port %p', (port) => {
    expect(ReadyLine.safeParse({ ...ok, port }).success).toBe(false);
  });

  it('rejects port 0 — the line must carry the port actually bound', () => {
    expect(ReadyLine.safeParse({ ...ok, port: 0 }).success).toBe(false);
  });

  it('rejects a success line that carries an error instead of a port', () => {
    expect(ReadyLine.safeParse({ ready: true, error: failed.error }).success).toBe(false);
  });

  it('rejects a failed line with an unknown error code', () => {
    const bad = { ready: false, error: { code: 'NOPE', message: 'x' } };
    expect(ReadyLine.safeParse(bad).success).toBe(false);
  });

  it('rejects a failed line with an empty message', () => {
    const bad = { ready: false, error: { code: 'CONFIG_INVALID', message: '' } };
    expect(ReadyLine.safeParse(bad).success).toBe(false);
  });

  it('survives a JSON round trip, which is how the shell reads it', () => {
    expect(ReadyLine.parse(JSON.parse(JSON.stringify(ok)))).toStrictEqual(ok);
  });
});
