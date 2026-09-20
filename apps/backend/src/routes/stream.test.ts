import { pino } from 'pino';
import { afterEach, describe, expect, it } from 'vitest';

import { ALLOWED_ORIGINS } from '../platform/security.js';
import { call, signIn, startAuthTestServer, type AuthTestServer } from '../testing/auth-server.js';

/**
 * `GET /api/v1/stream` over a real socket (ruling R36, ADR-0017).
 *
 * `EventSource` is deliberately not used — it cannot send headers, which is the
 * whole reason ADR-0017 reads the stream with `fetch` instead — so these tests
 * read the response body the same way the UI client does.
 */

const EMAIL = 'professor@example.edu';
const PASSWORD = 'correct horse battery staple';

let harness: AuthTestServer | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

async function withUser(streamHeartbeatMs?: number): Promise<{ h: AuthTestServer; token: string }> {
  harness = await startAuthTestServer(streamHeartbeatMs === undefined ? {} : { streamHeartbeatMs });
  await harness.auth.seed({ email: EMAIL, password: PASSWORD });
  return { h: harness, token: await signIn(harness, EMAIL, PASSWORD) };
}

interface OpenStream {
  readonly response: Response;
  /** Reads until `predicate` is happy or the timeout lapses. */
  readUntil(predicate: (text: string) => boolean, timeoutMs?: number): Promise<string>;
  close(): void;
}

async function openStream(
  h: AuthTestServer,
  token: string,
  headers: Record<string, string> = {},
): Promise<OpenStream> {
  const controller = new AbortController();
  const response = await fetch(`${h.server.baseUrl}/api/v1/stream`, {
    headers: {
      'X-CompIntel-Client': h.server.config.clientSecret,
      Authorization: `Bearer ${token}`,
      ...headers,
    },
    signal: controller.signal,
  });
  const reader = response.body?.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  return {
    response,
    readUntil: async (predicate, timeoutMs = 3_000) => {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(buffer)) {
        if (Date.now() > deadline || reader === undefined) {
          throw new Error(`the stream never satisfied the predicate. Got:\n${buffer}`);
        }
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value as Uint8Array, { stream: true });
      }
      return buffer;
    },
    close: () => {
      controller.abort();
    },
  };
}

function eventIds(text: string): number[] {
  return [...text.matchAll(/^id: (\d+)$/gm)].map((match) => Number(match[1]));
}

describe('opening the stream', () => {
  it('refuses without a session', async () => {
    const { h } = await withUser();
    const response = await call(h, '/api/v1/stream');
    expect(response.status).toBe(401);
  });

  it('answers text/event-stream and says hello', async () => {
    const { h, token } = await withUser();
    const stream = await openStream(h, token);

    expect(stream.response.status).toBe(200);
    expect(stream.response.headers.get('content-type')).toContain('text/event-stream');
    expect(stream.response.headers.get('cache-control')).toContain('no-cache');

    const text = await stream.readUntil((value) => value.includes('event: stream.ready'));
    expect(eventIds(text)).toStrictEqual([1]);
    stream.close();
  });

  it('delivers what is published while it is open, in order', async () => {
    const { h, token } = await withUser();
    const stream = await openStream(h, token);
    await stream.readUntil((value) => value.includes('stream.ready'));

    h.hub.publish('data.invalidated', { domain: 'events' });
    h.hub.publish('data.invalidated', { domain: 'teams' });

    const text = await stream.readUntil((value) => value.includes('"teams"'));
    expect(eventIds(text)).toStrictEqual([1, 2, 3]);
    expect(text).toContain('event: data.invalidated');
    stream.close();
  });

  it('sends a heartbeat comment', async () => {
    const { h, token } = await withUser(40);
    const stream = await openStream(h, token);
    const text = await stream.readUntil((value) => value.includes(': keep-alive'));
    expect(text).toContain(': keep-alive');
    stream.close();
  });

  it('carries the CORS headers the WebView needs (ruling R9)', async () => {
    // `writeHead` on the raw socket bypasses everything Fastify queued, so this
    // is not theory: without the headers carried over, the browser blocks a
    // response whose preflight it just accepted, and the stream "drops" the
    // moment it opens. Found on the built app during WP-07a.
    const { h, token } = await withUser();
    const stream = await openStream(h, token, { Origin: ALLOWED_ORIGINS[0] });

    expect(stream.response.headers.get('access-control-allow-origin')).toBe(ALLOWED_ORIGINS[0]);
    expect(stream.response.headers.get('x-request-id')).not.toBeNull();
    await stream.readUntil((value) => value.includes('stream.ready'));
    stream.close();
  });

  it('carries no user-identifying data beyond ids (ruling R36)', async () => {
    const { h, token } = await withUser();
    const stream = await openStream(h, token);
    const text = await stream.readUntil((value) => value.includes('stream.ready'));
    expect(text).not.toContain(EMAIL);
    expect(text).not.toContain(token);
    stream.close();
  });
});

describe('Last-Event-ID (ruling R36)', () => {
  it('replays what the client missed', async () => {
    const { h, token } = await withUser();
    // Three events happened while nobody was listening.
    h.hub.publish('data.invalidated', { domain: 'a' });
    h.hub.publish('data.invalidated', { domain: 'b' });
    h.hub.publish('data.invalidated', { domain: 'c' });

    const stream = await openStream(h, token, { 'Last-Event-ID': '1' });
    const text = await stream.readUntil((value) => value.includes('stream.ready'));
    // 2 and 3 replayed, then the ready event.
    expect(eventIds(text)).toStrictEqual([2, 3, 4]);
    expect(text).toContain('"replayComplete":true');
    stream.close();
  });

  it('says so when it cannot catch the client up', async () => {
    harness = await startAuthTestServer();
    await harness.auth.seed({ email: EMAIL, password: PASSWORD });
    const token = await signIn(harness, EMAIL, PASSWORD);
    for (let index = 0; index < 5; index += 1) {
      harness.hub.publish('data.invalidated');
    }
    // The hub's buffer starts at 1, so asking to resume from an id it never had
    // is what a very stale client looks like.
    const stream = await openStream(harness, token, { 'Last-Event-ID': '999' });
    const text = await stream.readUntil((value) => value.includes('stream.ready'));
    expect(text).toContain('"replayComplete"');
    stream.close();
  });
});

describe('shutdown (rulings R14 and R36)', () => {
  it('registers the hub as a streams-phase hook', async () => {
    const { h } = await withUser();
    expect(h.server.app.shutdown.names('streams')).toContain('sse-hub');
  });

  it('ends open streams before the server closes', async () => {
    const { h, token } = await withUser();
    const stream = await openStream(h, token);
    await stream.readUntil((value) => value.includes('stream.ready'));
    expect(h.hub.subscriberCount).toBe(1);

    // The `streams` phase runs first (R14); if it did not, `server.close()`
    // would sit waiting for a response that never ends by itself.
    await h.server.app.shutdown.runPhase('streams', pino({ enabled: false }));
    expect(h.hub.subscriberCount).toBe(0);

    await Promise.race([
      h.server.app.server.close(),
      new Promise((_resolve, reject) => setTimeout(() => reject(new Error('close hung')), 3_000)),
    ]);
  });
});
