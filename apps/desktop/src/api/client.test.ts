import { problemType } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from './auth-token.js';
import {
  apiGet,
  apiRequest,
  apiTransport,
  CLIENT_SECRET_HEADER,
  fetchHealth,
  FETCH_TIMEOUT_MS,
  resetApiTransport,
} from './client.js';
import { ApiProblem, isConflict } from './problem.js';

/**
 * The transport guarantees WP-05a/05b proved, carried over when the module moved
 * out of `src/shell`, plus what WP-06 adds: the session-token seam, problem+json
 * parsing, the generation retry and ruling R27's 2 s timeout.
 */

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ invoke }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

const CONNECTION = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

const RESTARTED = {
  baseUrl: 'http://127.0.0.1:52992',
  clientSecret: 'b'.repeat(64),
  generation: 3,
};

const HEALTH = {
  status: 'ok',
  appVersion: '0.1.0',
  apiVersion: '1.0.0',
  startedAt: '2026-09-20T12:00:00.000Z',
  uptimeSec: 12,
  database: { ok: true, migrationsApplied: 2 },
};

const NOT_FOUND = {
  type: problemType('NOT_FOUND'),
  title: 'That event does not exist',
  status: 404,
  code: 'NOT_FOUND',
  requestId: 'req-7',
  detail: 'No event with that id.',
  hint: 'It may have been merged into another one.',
  retryable: false,
};

/** Routes each IPC command to a canned answer, the way the shell would. */
function shell(answers: { connection?: unknown; proxy?: unknown }): void {
  invoke.mockImplementation((command: string) => {
    if (command === 'backend_connection') {
      return answers.connection === undefined
        ? Promise.reject(new Error('backend is not ready'))
        : Promise.resolve(answers.connection);
    }
    if (command === 'backend_get') {
      return answers.proxy === undefined
        ? Promise.reject(new Error('no proxy answer configured'))
        : Promise.resolve(answers.proxy);
    }
    return Promise.reject(new Error(`unexpected command ${command}`));
  });
}

/** Awaits a request that must fail and hands back the problem it threw. */
async function failure(request: Promise<unknown>): Promise<ApiProblem> {
  try {
    await request;
  } catch (cause) {
    return cause as ApiProblem;
  }
  throw new Error('expected the request to fail, but it resolved');
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

beforeEach(() => {
  invoke.mockReset();
  resetApiTransport();
  setAuthToken(undefined);
});

afterEach(() => {
  vi.unstubAllGlobals();
  setAuthToken(undefined);
});

describe('the request headers (ADR-0017)', () => {
  it('sends the per-spawn client secret on every request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HEALTH));
    vi.stubGlobal('fetch', fetchMock);

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    await apiGet(CONNECTION, '/api/v1/health');

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const call of fetchMock.mock.calls) {
      const [url, init] = call as [string, RequestInit];
      expect(url).toBe('http://127.0.0.1:52991/api/v1/health');
      expect(init.headers).toMatchObject({ [CLIENT_SECRET_HEADER]: CONNECTION.clientSecret });
      // The signal is what makes a silently held request fall back (finding F9).
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });

  it('adds Authorization only once a session token exists (the WP-07a seam)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, HEALTH));
    vi.stubGlobal('fetch', fetchMock);

    await apiGet(CONNECTION, '/api/v1/health');
    const before = (fetchMock.mock.calls[0] as [string, RequestInit])[1].headers;
    expect(before).not.toHaveProperty('Authorization');

    setAuthToken('session-token');
    await apiGet(CONNECTION, '/api/v1/health');
    const after = (fetchMock.mock.calls[1] as [string, RequestInit])[1].headers;
    expect(after).toMatchObject({ Authorization: 'Bearer session-token' });
  });

  it('sends a JSON body with its content type', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest(CONNECTION, '/api/v1/teams', { method: 'POST', body: { name: 'Falcons' } });
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"name":"Falcons"}');
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' });
  });
});

describe('problem+json (§4.4, ruling R5)', () => {
  it('parses a problem body into a typed ApiProblem', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(404, NOT_FOUND)));

    const problem = await failure(apiGet(CONNECTION, '/api/v1/events/x'));
    expect(problem).toBeInstanceOf(ApiProblem);
    expect(problem.code).toBe('NOT_FOUND');
    expect(problem.status).toBe(404);
    expect(problem.title).toBe('That event does not exist');
    expect(problem.hint).toBe('It may have been merged into another one.');
    expect(problem.requestId).toBe('req-7');
    expect(problem.retryable).toBe(false);
  });

  it('turns a body that is not problem+json into INTERNAL', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(500, '<html>oops</html>')));

    const problem = await failure(apiGet(CONNECTION, '/api/v1/health'));
    expect(problem.code).toBe('INTERNAL');
    expect(problem.status).toBe(500);
    // A 500 is worth retrying even when the body told us nothing.
    expect(problem.retryable).toBe(true);
  });

  it('maps 409 so optimistic concurrency can be handled (§4.4)', async () => {
    const conflict = {
      type: problemType('CONFLICT'),
      title: 'Someone else changed this',
      status: 409,
      code: 'CONFLICT',
      requestId: 'req-9',
    };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(409, conflict)));

    const problem = await failure(
      apiRequest(CONNECTION, '/api/v1/teams/1', { method: 'PATCH', body: { version: 3 } }),
    );
    expect(isConflict(problem)).toBe(true);
    expect(problem.title).toBe('Someone else changed this');
  });
});

describe('the API transport (finding F9, ruling R27)', () => {
  it('starts on fetch and stays there while the server answers', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, HEALTH)));
    await fetchHealth(CONNECTION);
    expect(apiTransport()).toBe('FETCH');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('times out after 2 seconds, not five (ruling R27)', () => {
    expect(FETCH_TIMEOUT_MS).toBe(2_000);
  });

  it('falls back to the shell when the WebView cannot reach loopback at all', async () => {
    // What Local Network Access, a CORS refusal and a dead socket all look like.
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    shell({ connection: CONNECTION, proxy: { status: 200, body: JSON.stringify(HEALTH) } });

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    expect(invoke).toHaveBeenCalledWith('backend_get', {
      path: '/api/v1/health',
      authorization: null,
    });
    expect(apiTransport()).toBe('SHELL');
  });

  it('forwards the session token over the fallback too (ruling R27)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    shell({ connection: CONNECTION, proxy: { status: 200, body: JSON.stringify(HEALTH) } });
    setAuthToken('session-token');

    await expect(apiGet(CONNECTION, '/api/v1/me')).resolves.toStrictEqual(HEALTH);
    expect(invoke).toHaveBeenCalledWith('backend_get', {
      path: '/api/v1/me',
      authorization: 'Bearer session-token',
    });
  });

  it('falls back when the request is silently held open, not just rejected', async () => {
    // What WebView2 actually does with Local Network Access checks on: no
    // rejection and no answer. Without the timeout the UI waits for ever, which
    // is how WP-05b found this. The test passes a short timeout rather than
    // sitting here for the real two seconds.
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
    shell({ connection: CONNECTION, proxy: { status: 200, body: JSON.stringify(HEALTH) } });

    await expect(fetchHealth(CONNECTION, { timeoutMs: 30 })).resolves.toStrictEqual(HEALTH);
    expect(apiTransport()).toBe('SHELL');
  });

  it('stays on the fallback once it has switched, without trying fetch again', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    shell({ connection: CONNECTION, proxy: { status: 200, body: JSON.stringify(HEALTH) } });

    await fetchHealth(CONNECTION);
    await fetchHealth(CONNECTION);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(invoke.mock.calls.filter((call) => call[0] === 'backend_get')).toHaveLength(2);
  });

  it('treats an HTTP status as an answer, not as a broken transport', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(401, {})));

    await expect(fetchHealth(CONNECTION)).rejects.toThrow(ApiProblem);
    // Still the direct transport: the server answered, it just said no.
    expect(apiTransport()).toBe('FETCH');
    expect(invoke).not.toHaveBeenCalled();
  });

  it('surfaces a non-2xx answer from the fallback too', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    shell({ connection: CONNECTION, proxy: { status: 503, body: '{}' } });

    const problem = await failure(apiGet(CONNECTION, '/api/v1/health'));
    expect(problem.status).toBe(503);
  });

  it('refuses a proxy answer that is not the contract', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    shell({ connection: CONNECTION, proxy: { status: 'ok', body: '{}' } });

    await expect(apiGet(CONNECTION, '/api/v1/health')).rejects.toThrow(ApiProblem);
  });

  it('says plainly that a write cannot go through the read-only proxy', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    shell({ connection: CONNECTION, proxy: { status: 200, body: '{}' } });

    // The first call switches the transport…
    await apiGet(CONNECTION, '/api/v1/health');
    // …and a write afterwards is refused rather than silently dropped.
    const problem = await failure(
      apiRequest(CONNECTION, '/api/v1/teams', { method: 'POST', body: {} }),
    );
    expect(problem.title).toBe('This action is not available on this machine');
    expect(problem.detail).toMatch(/only forwards reads/);
    expect(problem.retryable).toBe(false);
  });
});

describe('a backend that restarted mid-request (§3.2, ruling A2)', () => {
  it('re-reads the connection and retries once with the new secret', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(jsonResponse(200, HEALTH));
    vi.stubGlobal('fetch', fetchMock);
    shell({ connection: RESTARTED });

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [retryUrl, retryInit] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(retryUrl).toBe('http://127.0.0.1:52992/api/v1/health');
    expect(retryInit.headers).toMatchObject({ [CLIENT_SECRET_HEADER]: RESTARTED.clientSecret });
    // The secret was the problem, not the transport.
    expect(apiTransport()).toBe('FETCH');
  });

  it('retries exactly once, then falls back rather than looping', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    shell({ connection: RESTARTED, proxy: { status: 200, body: JSON.stringify(HEALTH) } });

    await expect(fetchHealth(CONNECTION)).resolves.toStrictEqual(HEALTH);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(apiTransport()).toBe('SHELL');
  });

  it('does not retry when the generation is unchanged', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    shell({ connection: CONNECTION, proxy: { status: 200, body: JSON.stringify(HEALTH) } });

    await fetchHealth(CONNECTION);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(apiTransport()).toBe('SHELL');
  });
});
