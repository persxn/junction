import type { BackendStatus, ShellSettings } from '@compintel/contracts';
import { describe, expect, it, vi } from 'vitest';

import { copyDiagnostics, formatDiagnostics } from './diagnostics.js';

const STATUS: BackendStatus = {
  phase: 'FAILED',
  generation: 3,
  port: null,
  recentCrashes: 5,
  lastError: 'DATA_DIR_LOCKED: pid 4242',
  dataDir: 'C:\\Users\\x\\AppData\\Local\\CompIntel-dev',
  logsDir: 'C:\\Users\\x\\AppData\\Local\\CompIntel-dev\\logs',
  appVersion: '0.1.0',
};

const SETTINGS: ShellSettings = { closeToTray: true, autostart: false };

describe('the diagnostics report (ruling R25)', () => {
  it('carries backend_status() and the shell settings verbatim', () => {
    const report: unknown = JSON.parse(
      formatDiagnostics(
        { status: STATUS, settings: SETTINGS, transport: 'SHELL', error: 'timed out' },
        new Date('2026-09-20T10:00:00.000Z'),
      ),
    );
    expect(report).toMatchObject({
      capturedAt: '2026-09-20T10:00:00.000Z',
      apiTransport: 'SHELL',
      lastError: 'timed out',
      backendStatus: STATUS,
      shellSettings: SETTINGS,
    });
  });

  it('is still usable before anything has loaded', () => {
    const report = JSON.parse(
      formatDiagnostics({ status: undefined, settings: undefined, transport: 'FETCH' }),
    ) as Record<string, unknown>;
    expect(report.backendStatus).toBeNull();
    expect(report.shellSettings).toBeNull();
    expect(report.lastError).toBeNull();
  });
});

describe('copying it', () => {
  it('reports success', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });
    await expect(copyDiagnostics('report')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('report');
    vi.unstubAllGlobals();
  });

  it('reports failure rather than pretending, when the clipboard is blocked', async () => {
    vi.stubGlobal('navigator', {
      clipboard: {
        writeText: () => Promise.reject(new Error('document is not focused')),
      },
    });
    await expect(copyDiagnostics('report')).resolves.toBe(false);
    vi.unstubAllGlobals();
  });

  it('reports failure when there is no clipboard at all', async () => {
    vi.stubGlobal('navigator', {});
    await expect(copyDiagnostics('report')).resolves.toBe(false);
    vi.unstubAllGlobals();
  });
});
