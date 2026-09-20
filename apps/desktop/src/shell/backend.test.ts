import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  apiGet,
  ApiError,
  apiTransport,
  BACKEND_STATUS_EVENT,
  backendConnection,
  backendStatus,
  CLIENT_SECRET_HEADER,
  exitCompletely,
  fetchHealth,
  FETCH_TIMEOUT_MS,
  hideToTray,
  onBackendStatus,
  openLogsFolder,
  resetApiTransport,
  retryBackend,
  setAutostart,
  setCloseToTray,
  shellSettings,
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

const SETTINGS = { closeToTray: true, autostart: false };

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
  resetApiTransport();
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
    await hideToTray();
    const names = invoke.mock.calls.map((call) => String(call[0]));
    expect(names).toStrictEqual([
      'retry_backend',
      'exit_completely',
      'open_logs_folder',
      'hide_to_tray',
    ]);
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

describe('the shell settings (D-14)', () => {
  it('reads them', async () => {
    invoke.mockResolvedValue(SETTINGS);
    await expect(shellSettings()).resolves.toStrictEqual(SETTINGS);
    expect(invoke).toHaveBeenCalledWith('shell_settings');
  });

  it('writes close-to-tray and start-with-Windows with the enabled flag', async () => {
    invoke.mockResolvedValue({ closeToTray: false, autostart: true });
    await expect(setCloseToTray(false)).resolves.toStrictEqual({
      closeToTray: false,
      autostart: true,
    });
    await setAutostart(true);
    expect(invoke.mock.calls).toStrictEqual([
      ['set_close_to_tray', { enabled: false }],
      ['set_autostart', { enabled: true }],
    ]);
  });

  it('refuses settings that are not booleans', async () => {
    invoke.mockResolvedValue({ closeToTray: 'yes', autostart: false });
    await expect(shellSettings()).rejects.toThrow();
  });
});

describe('the API transport (finding F9)', () => {
  it('uses fetch and sends the client secret', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(HEALTH),
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://127.0.0.1:52991/api/v1/health');
    expect(init.headers).toStrictEqual({ [CLIENT_SECRET_HEADER]: CONNECTION.clientSecret });
    // The signal is what makes a silently held request fall back (finding F9).
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(apiTransport()).toBe('FETCH');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('falls back to the shell when the WebView cannot reach loopback at all', async () => {
    // What Local Network Access, a CORS refusal and a dead socket all look like.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ status: 200, body: JSON.stringify(HEALTH) });

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    expect(invoke).toHaveBeenCalledWith('backend_get', { path: '/api/v1/health' });
    expect(apiTransport()).toBe('SHELL');
  });

  it('falls back when the request is silently held open, not just rejected', async () => {
    // What WebView2 actually does with Local Network Access checks on: no
    // rejection and no answer. Without the timeout the UI waits for ever, which
    // is how WP-05b found this. The real timeout is FETCH_TIMEOUT_MS; the test
    // passes a short one rather than sitting here for five seconds.
    expect(FETCH_TIMEOUT_MS).toBeGreaterThan(0);
    vi.stubGlobal(
      'fetch',
      vi.fn((_url: string, init?: { signal?: AbortSignal }) => {
        return new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted.', 'TimeoutError'));
          });
        });
      }),
    );
    invoke.mockResolvedValue({ status: 200, body: JSON.stringify(HEALTH) });

    await expect(fetchHealth(CONNECTION, { timeoutMs: 30 })).resolves.toStrictEqual(HEALTH);
    expect(invoke).toHaveBeenCalledWith('backend_get', { path: '/api/v1/health' });
    expect(apiTransport()).toBe('SHELL');
  });

  it('stays on the fallback once it has switched, without trying fetch again', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    invoke.mockResolvedValue({ status: 200, body: JSON.stringify(HEALTH) });

    await fetchHealth(CONNECTION);
    await fetchHealth(CONNECTION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it('treats an HTTP status as an answer, not as a broken transport', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: () => Promise.resolve({}) }),
    );

    await expect(fetchHealth(CONNECTION)).rejects.toThrow(ApiError);
    await expect(fetchHealth(CONNECTION)).rejects.toThrow(/401/);
    // Still the direct transport: the server answered, it just said no.
    expect(apiTransport()).toBe('FETCH');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx answer from the fallback too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ status: 503, body: '{}' });

    await expect(apiGet(CONNECTION, '/api/v1/health')).rejects.toThrow(/503/);
  });

  it('refuses a proxy answer that is not the contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    invoke.mockResolvedValue({ status: 'ok', body: '{}' });

    await expect(apiGet(CONNECTION, '/api/v1/health')).rejects.toThrow();
  });
});
