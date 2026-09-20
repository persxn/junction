import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  BACKEND_STATUS_EVENT,
  backendConnection,
  backendGet,
  backendStatus,
  exitCompletely,
  hideToTray,
  onBackendStatus,
  openLogsFolder,
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

const SETTINGS = { closeToTray: true, autostart: false };

beforeEach(() => {
  invoke.mockReset();
  listen.mockReset();
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

  it('parses the proxy answer (the finding-F9 fallback, ruling R27)', async () => {
    invoke.mockResolvedValue({ status: 200, body: '{}' });
    await expect(backendGet('/api/v1/health')).resolves.toStrictEqual({
      status: 200,
      body: '{}',
    });
    // Ruling R27: the token slot is always sent, null when there is no session.
    expect(invoke).toHaveBeenCalledWith('backend_get', {
      path: '/api/v1/health',
      authorization: null,
    });
  });

  it('refuses a proxy answer that is not the contract', async () => {
    invoke.mockResolvedValue({ status: 'ok', body: '{}' });
    await expect(backendGet('/api/v1/health')).rejects.toThrow();
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

describe('the shell settings (D-14, ruling R28)', () => {
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
