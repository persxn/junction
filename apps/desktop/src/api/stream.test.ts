import type { BackendConnection } from '@compintel/contracts';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { setAuthToken } from './auth-token.js';
import { CLIENT_SECRET_HEADER } from './client.js';
import {
  openStream,
  parseSseChunk,
  RECONNECT_DELAYS_MS,
  type StreamUnavailableReason,
} from './stream.js';

/**
 * The in-house SSE client (ADR-0017, rulings R30 and R36).
 *
 * Every test injects both seams — `schedule` and `transport` — so the backoff
 * ladder is asserted as numbers rather than waited out, and the machine the test
 * runs on never decides which transport is under test.
 */

const CONNECTION: BackendConnection = {
  baseUrl: 'http://127.0.0.1:52991',
  clientSecret: 'a'.repeat(64),
  generation: 2,
};

/** A scheduler that records what was asked for and fires it on demand. */
function fakeScheduler(): {
  readonly delays: number[];
  readonly cancelled: number[];
  schedule: (run: () => void, delayMs: number) => () => void;
  fire: () => Promise<void>;
} {
  const delays: number[] = [];
  const cancelled: number[] = [];
  const pending: (() => void)[] = [];
  return {
    delays,
    cancelled,
    schedule: (run, delayMs) => {
      const index = delays.length;
      delays.push(delayMs);
      pending.push(run);
      return () => {
        cancelled.push(index);
      };
    },
    fire: async () => {
      const run = pending.shift();
      run?.();
      await vi.waitFor(() => undefined);
    },
  };
}

/** A response whose body yields these chunks and then ends the connection. */
function sseResponse(chunks: readonly string[], status = 200): Response {
  const encoder = new TextEncoder();
  let index = 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    body: {
      getReader: () => ({
        read: () =>
          index < chunks.length
            ? Promise.resolve({ done: false, value: encoder.encode(chunks[index++]) })
            : Promise.resolve({ done: true, value: undefined }),
      }),
    },
  } as unknown as Response;
}

/** A response that stays open for ever, so nothing reconnects behind the test. */
function openForever(): Response {
  return {
    ok: true,
    status: 200,
    body: { getReader: () => ({ read: () => new Promise<never>(() => undefined) }) },
  } as unknown as Response;
}

function errorResponse(status: number): Response {
  return { ok: false, status, body: null } as unknown as Response;
}

function frame(id: number, type: string, payload: Record<string, unknown> = {}): string {
  return `id: ${String(id)}\ndata: ${JSON.stringify({ id, type, payload })}\n\n`;
}

beforeEach(() => {
  setAuthToken(undefined);
});

afterEach(() => {
  setAuthToken(undefined);
});

describe('parseSseChunk (ruling R36)', () => {
  it('reads one event out of a frame', () => {
    expect(parseSseChunk('id: 7\ndata: {"id":7,"type":"stream.ready","payload":{}}')).toStrictEqual(
      {
        id: 7,
        type: 'stream.ready',
        payload: {},
      },
    );
  });

  it('joins a data field that was split over several lines', () => {
    const block = 'data: {"id":1,"type":"data.invalidated",\ndata: "payload":{"domain":"events"}}';
    expect(parseSseChunk(block)).toStrictEqual({
      id: 1,
      type: 'data.invalidated',
      payload: { domain: 'events' },
    });
  });

  it.each([
    [': heartbeat', 'the 15 s comment heartbeat'],
    ['event: ping\nretry: 1000', 'a frame with no data at all'],
    ['data: not json', 'a body that is not JSON'],
    ['data: {"id":0,"type":"stream.ready","payload":{}}', 'an id below the contract minimum'],
    ['data: {"id":1,"type":"invented","payload":{}}', 'a type nobody agreed to'],
  ])('skips %s (%s)', (block) => {
    expect(parseSseChunk(block)).toBeUndefined();
  });
});

describe('the connection (ADR-0017)', () => {
  it('sends the client secret, the bearer token and Accept, and reports events', async () => {
    setAuthToken('session-token');
    const fetchImpl = vi.fn().mockResolvedValue(sseResponse([frame(1, 'stream.ready')]));
    const events: number[] = [];
    const opened = vi.fn();
    const scheduler = fakeScheduler();

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      {
        onEvent: (event) => events.push(event.id),
        onOpen: opened,
      },
    );

    await vi.waitFor(() => {
      expect(events).toStrictEqual([1]);
    });
    expect(opened).toHaveBeenCalledTimes(1);

    const [url, init] = fetchImpl.mock.calls[0] as [string, { headers: Record<string, string> }];
    expect(url).toBe(`${CONNECTION.baseUrl}/api/v1/stream`);
    expect(init.headers).toMatchObject({
      [CLIENT_SECRET_HEADER]: CONNECTION.clientSecret,
      Accept: 'text/event-stream',
      Authorization: 'Bearer session-token',
    });
    // Nothing to resume from on the first attempt.
    expect(init.headers).not.toHaveProperty('Last-Event-ID');

    subscription.close();
  });

  it('resumes from the highest event id it has seen', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(sseResponse([frame(1, 'stream.ready'), frame(4, 'job.progress')]))
      .mockResolvedValue(openForever());
    const scheduler = fakeScheduler();

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined },
    );

    await vi.waitFor(() => {
      expect(subscription.lastEventId()).toBe(4);
    });
    await scheduler.fire();

    await vi.waitFor(() => {
      expect(fetchImpl).toHaveBeenCalledTimes(2);
    });
    const [, init] = fetchImpl.mock.calls[1] as [string, { headers: Record<string, string> }];
    expect(init.headers['Last-Event-ID']).toBe('4');

    subscription.close();
  });

  it('walks up the backoff ladder and stays at the top', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const scheduler = fakeScheduler();

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined },
    );

    await vi.waitFor(() => {
      expect(scheduler.delays).toHaveLength(1);
    });
    for (let attempt = 0; attempt < RECONNECT_DELAYS_MS.length + 1; attempt += 1) {
      await scheduler.fire();
    }

    expect(scheduler.delays).toStrictEqual([...RECONNECT_DELAYS_MS, 30_000, 30_000]);
    subscription.close();
  });

  it('starts the ladder again after a connection that worked', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(errorResponse(503))
      .mockResolvedValueOnce(sseResponse([frame(1, 'stream.ready')]))
      .mockResolvedValue(openForever());
    const scheduler = fakeScheduler();

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined },
    );

    await vi.waitFor(() => {
      expect(scheduler.delays).toStrictEqual([1_000]);
    });
    await scheduler.fire();
    await vi.waitFor(() => {
      expect(scheduler.delays).toStrictEqual([1_000, 1_000]);
    });

    subscription.close();
  });

  it('cancels a pending reconnect when it is closed', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const scheduler = fakeScheduler();

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined },
    );

    await vi.waitFor(() => {
      expect(scheduler.delays).toHaveLength(1);
    });
    subscription.close();
    expect(scheduler.cancelled).toStrictEqual([0]);

    // Even if the timer had already escaped, a closed stream opens nothing.
    await scheduler.fire();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('what stops it trying again', () => {
  it.each([401, 403])('treats %i as UNAUTHENTICATED and does not reconnect', async (status) => {
    const fetchImpl = vi.fn().mockResolvedValue(errorResponse(status));
    const scheduler = fakeScheduler();
    const reasons: (StreamUnavailableReason | undefined)[] = [];

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'FETCH',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined, onUnavailable: (reason) => reasons.push(reason) },
    );

    await vi.waitFor(() => {
      expect(reasons).toStrictEqual(['UNAUTHENTICATED']);
    });
    expect(scheduler.delays).toStrictEqual([]);
    subscription.close();
  });

  it('says NO_TRANSPORT without a request when the shell is carrying the API (R30)', async () => {
    const fetchImpl = vi.fn();
    const scheduler = fakeScheduler();
    const reasons: (StreamUnavailableReason | undefined)[] = [];

    const subscription = openStream(
      {
        connection: CONNECTION,
        fetchImpl,
        transport: () => 'SHELL',
        schedule: scheduler.schedule,
      },
      { onEvent: () => undefined, onUnavailable: (reason) => reasons.push(reason) },
    );

    await vi.waitFor(() => {
      expect(reasons).toStrictEqual(['NO_TRANSPORT']);
    });
    // The shell proxy is request/response only: there is nothing to attempt and
    // nothing a retry would fix.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(scheduler.delays).toStrictEqual([]);
    subscription.close();
  });
});
