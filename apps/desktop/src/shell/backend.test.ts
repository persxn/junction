import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKEND_STATUS_EVENT,
  backendConnection,
  backendStatus,
  CLIENT_SECRET_HEADER,
  exitCompletely,
  fetchHealth,
  onBackendStatus,
  openLogsFolder,
  retryBackend,
} from './backend.js';

const invoke = vi.hoisted(() => vi.fn());
const listen = vi.hoisted(() => vi.fn());

vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen }));

const STATUS = {
  phase: 'READY',
  generation: 2,
  port: 52991,
  recentCrashes: 1,
  lastError: null,
  dataDir: 'C:\\Users\\x\\AppData\\Local\\CompIntel-dev',
  logsDir: 'C:\\Users\\x\\AppData\\Local\\CompIntel-dev\\logs',
  appVersion: '0.1.0',
};

const CONNECTION = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const HEALTH = {
  status: 'ok',
  appVersion: '0.1.0',
  apiVersion: '1.0.0',
  startedAt: '2026-09-20T12:00:00.000Z',
  uptimeSec: 12,
  database: { ok: true, migrationsApplied: 2 },
};

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('the IPC wrappers', () => {
  it('parses the status the shell sends', async () => {
    invoke.mockResolvedValue(STATUS);
    await expect(backendStatus()).resolves.toStrictEqual(STATUS);
    expect(invoke).toHaveBeenCalledWith('backend_status');
  });

  it('refuses a status that does not match the contract', async () => {
    invoke.mockResolvedValue({ ...STATUS, phase: 'CONFUSED' });
    await expect(backendStatus()).rejects.toThrow();
  });

  it('parses the connection (ruling A2)', async () => {
    invoke.mockResolvedValue(CONNECTION);
    await expect(backendConnection()).resolves.toStrictEqual(CONNECTION);
    expect(invoke).toHaveBeenCalledWith('backend_connection');
  });

  it('refuses a base URL that is not loopback', async () => {
    invoke.mockResolvedValue({ ...CONNECTION, baseUrl: 'http://evil.example.com:52991' });
    await expect(backendConnection()).rejects.toThrow();
  });

  it('refuses a client secret that is not 32 hex-encoded bytes', async () => {
    invoke.mockResolvedValue({ ...CONNECTION, clientSecret: 'short' });
    await expect(backendConnection()).rejects.toThrow();
  });

  it('passes the shell commands straight through', async () => {
    invoke.mockResolvedValue(undefined);
    await retryBackend();
    await exitCompletely();
    await openLogsFolder();
    const names = invoke.mock.calls.map((call) => String(call[0]));
    expect(names).toStrictEqual(['retry_backend', 'exit_completely', 'open_logs_folder']);
  });

  it('subscribes to the status event and validates every payload', async () => {
    const seen: unknown[] = [];
    let emit: ((event: { payload: unknown }) => void) | undefined;
    listen.mockImplementation((_name: string, handler: (event: { payload: unknown }) => void) => {
      emit = handler;
      return Promise.resolve(() => undefined);
    });

    await onBackendStatus((status) => {
      seen.push(status);
    });
    expect(listen).toHaveBeenCalledWith(BACKEND_STATUS_EVENT, expect.any(Function));

    emit?.({ payload: STATUS });
    expect(seen).toStrictEqual([STATUS]);
    expect(() => {
      emit?.({ payload: { phase: 'READY' } });
    }).toThrow();
  });
});

describe('fetchHealth', () => {
  it('sends the client secret and parses the body', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(HEALTH),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:52991/api/v1/health', {
      headers: { [CLIENT_SECRET_HEADER]: CONNECTION.clientSecret },
    });
  });

  it('turns a rejected request into an error naming the status', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );
    await expect(fetchHealth(CONNECTION)).rejects.toThrow(/401/);
  });
});
