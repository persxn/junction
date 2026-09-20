import { HealthResponse } from '@compintel/contracts';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { API_PREFIX } from '../app.js';
import { authedFetch, startTestServer, testConfig, type TestServer } from '../testing/harness.js';

let server: TestServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe('GET /health', () => {
  it('answers with the contract body', async () => {
    const startedAt = new Date('2026-09-20T09:00:00.000Z');
    server = await startTestServer({
      startedAt,
      now: () => new Date('2026-09-20T09:02:05.400Z'),
      database: () => ({ ok: true, migrationsApplied: 3 }),
    });

    const response = await authedFetch(server, `${API_PREFIX}/health`);
    expect(response.status).toBe(200);

    const health = HealthResponse.parse(await response.json());
    expect(health).toStrictEqual({
      status: 'ok',
      appVersion: server.config.appVersion,
      apiVersion: server.config.apiVersion,
      startedAt: startedAt.toISOString(),
      uptimeSec: 125,
      database: { ok: true, migrationsApplied: 3 },
    });
  });

  it('reports a database that is not ready, without failing the probe', async () => {
    server = await startTestServer({ database: () => ({ ok: false, migrationsApplied: 0 }) });
    const response = await authedFetch(server, `${API_PREFIX}/health`);

    expect(response.status).toBe(200);
    expect(HealthResponse.parse(await response.json()).database).toStrictEqual({
      ok: false,
      migrationsApplied: 0,
    });
  });

  it('reads the database state per request, not once at boot', async () => {
    let ok = false;
    server = await startTestServer({ database: () => ({ ok, migrationsApplied: 1 }) });

    const before = HealthResponse.parse(
      await (await authedFetch(server, `${API_PREFIX}/health`)).json(),
    );
    ok = true;
    const after = HealthResponse.parse(
      await (await authedFetch(server, `${API_PREFIX}/health`)).json(),
    );

    expect(before.database.ok).toBe(false);
    expect(after.database.ok).toBe(true);
  });

  it('never reports a negative uptime if the clock steps back', async () => {
    server = await startTestServer({
      startedAt: new Date('2026-09-20T09:00:00.000Z'),
      now: () => new Date('2026-09-20T08:59:00.000Z'),
    });
    const health = HealthResponse.parse(
      await (await authedFetch(server, `${API_PREFIX}/health`)).json(),
    );
    expect(health.uptimeSec).toBe(0);
  });

  it('is not reachable without the /api/v1 prefix', async () => {
    server = await startTestServer();
    const response = await authedFetch(server, '/health');
    expect(response.status).toBe(404);
  });
});

describe('POST /system/shutdown', () => {
  it('answers 202 and then asks the process to shut down', async () => {
    const onShutdownRequested = vi.fn();
    server = await startTestServer({ onShutdownRequested });

    const response = await authedFetch(server, `${API_PREFIX}/system/shutdown`, { method: 'POST' });
    expect(response.status).toBe(202);
    expect(await response.json()).toStrictEqual({ accepted: true });

    await vi.waitFor(() => {
      expect(onShutdownRequested).toHaveBeenCalledTimes(1);
    });
  });

  it('rejects GET on the shutdown route', async () => {
    const onShutdownRequested = vi.fn();
    server = await startTestServer({ onShutdownRequested });

    const response = await authedFetch(server, `${API_PREFIX}/system/shutdown`);
    expect(response.status).toBe(404);
    expect(onShutdownRequested).not.toHaveBeenCalled();
  });
});

describe('body limit', () => {
  it('refuses a body larger than 1 MB', async () => {
    server = await startTestServer({ config: testConfig() });
    const response = await authedFetch(server, `${API_PREFIX}/system/shutdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ padding: 'x'.repeat(1024 * 1024 + 16) }),
    });
    expect(response.status).toBe(413);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
  });
});
