import {
  StreamEvent,
  type BackendConnection,
  type StreamEvent as Event,
} from '@compintel/contracts';

import { apiTransport, CLIENT_SECRET_HEADER } from './client.js';
import { authToken } from './auth-token.js';

/**
 * The SSE client (ADR-0017, §4.4, rulings R30 and R36).
 *
 * `EventSource` cannot send headers, and ADR-0017 refuses to put a token in a
 * URL, so the stream is read with `fetch` + `ReadableStream` instead — about a
 * hundred lines, and the same two headers as every other request.
 *
 * Ruling R30 is the other half: the shell's fallback transport is
 * request/response only, so on a machine where WebView2 blocks loopback there is
 * no stream at all. That is a degradation, not a failure — the client says "live
 * updates unavailable" and the caller polls instead.
 */

/** Reconnect backoff, in milliseconds. The last value repeats. */
export const RECONNECT_DELAYS_MS = [1_000, 2_000, 5_000, 10_000, 30_000] as const;

/** How often the caller should poll when the stream is unavailable (R30). */
export const POLL_INTERVAL_MS = 30_000;

/** Why the stream is not running. */
export type StreamUnavailableReason =
  /** The WebView cannot reach loopback, so there is no stream transport (R30). */
  | 'NO_TRANSPORT'
  /** The connection dropped; a reconnect is scheduled. */
  | 'DISCONNECTED'
  /** The session is gone; the caller signs out rather than reconnecting. */
  | 'UNAUTHENTICATED';

export interface StreamHandlers {
  readonly onEvent: (event: Event) => void;
  /** Called when the stream opens, and again after every successful reconnect. */
  readonly onOpen?: () => void;
  /** Called with why it is down; `undefined` when it comes back. */
  readonly onUnavailable?: (reason: StreamUnavailableReason | undefined) => void;
}

export interface StreamOptions {
  readonly connection: BackendConnection;
  /** Test seam; defaults to the real `setTimeout`. */
  readonly schedule?: (run: () => void, delayMs: number) => () => void;
  /** Test seam; defaults to `apiTransport()`. */
  readonly transport?: () => 'FETCH' | 'SHELL';
  readonly fetchImpl?: typeof fetch;
}

function delayFor(attempt: number): number {
  return RECONNECT_DELAYS_MS[Math.min(attempt, RECONNECT_DELAYS_MS.length - 1)] ?? 30_000;
}

/**
 * Splits an SSE byte stream into frames. Comments (the heartbeat) and unknown
 * fields are skipped; anything that does not parse as a `StreamEvent` is skipped
 * too, because one bad frame must not kill a live connection.
 */
export function parseSseChunk(block: string): Event | undefined {
  const data = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim())
    .join('\n');
  if (data === '') {
    return undefined;
  }
  try {
    const parsed = StreamEvent.safeParse(JSON.parse(data));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}

export interface StreamSubscription {
  /** Stops the stream and cancels any pending reconnect. */
  close(): void;
  /** The id of the last event seen, which a reconnect resumes from. */
  lastEventId(): number;
}

/**
 * Opens `/api/v1/stream` and keeps it open.
 *
 * It resumes with `Last-Event-ID` after a drop, so a reconnect inside the
 * server's replay window loses nothing; outside it, the server says the replay
 * was incomplete and the caller invalidates everything.
 */
export function openStream(options: StreamOptions, handlers: StreamHandlers): StreamSubscription {
  const schedule =
    options.schedule ??
    ((run: () => void, delayMs: number): (() => void) => {
      const timer = setTimeout(run, delayMs);
      return () => {
        clearTimeout(timer);
      };
    });
  const transport = options.transport ?? apiTransport;
  const doFetch = options.fetchImpl ?? fetch;

  let closed = false;
  let attempt = 0;
  let lastEventId = 0;
  let controller: AbortController | undefined;
  let cancelReconnect: (() => void) | undefined;

  const unavailable = (reason: StreamUnavailableReason | undefined): void => {
    handlers.onUnavailable?.(reason);
  };

  const reconnect = (reason: StreamUnavailableReason): void => {
    if (closed) {
      return;
    }
    unavailable(reason);
    if (reason === 'UNAUTHENTICATED' || reason === 'NO_TRANSPORT') {
      // Neither gets better by trying again: one needs a new session, the other
      // needs a different browser.
      return;
    }
    const delay = delayFor(attempt);
    attempt += 1;
    cancelReconnect = schedule(() => {
      void connect();
    }, delay);
  };

  async function connect(): Promise<void> {
    if (closed) {
      return;
    }
    // Ruling R30: the shell proxy is request/response only. There is nothing to
    // retry and nothing to fix, so say so once and let the caller poll.
    if (transport() === 'SHELL') {
      reconnect('NO_TRANSPORT');
      return;
    }

    controller = new AbortController();
    const headers: Record<string, string> = {
      [CLIENT_SECRET_HEADER]: options.connection.clientSecret,
      Accept: 'text/event-stream',
    };
    const token = authToken();
    if (token !== undefined) {
      headers.Authorization = `Bearer ${token}`;
    }
    if (lastEventId > 0) {
      headers['Last-Event-ID'] = String(lastEventId);
    }

    let response: Response;
    try {
      response = await doFetch(`${options.connection.baseUrl}/api/v1/stream`, {
        headers,
        signal: controller.signal,
      });
    } catch {
      reconnect('DISCONNECTED');
      return;
    }

    if (response.status === 401 || response.status === 403) {
      reconnect('UNAUTHENTICATED');
      return;
    }
    if (!response.ok || response.body === null) {
      reconnect('DISCONNECTED');
      return;
    }

    attempt = 0;
    unavailable(undefined);
    handlers.onOpen?.();

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) {
          break;
        }
        buffer += decoder.decode(chunk.value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split >= 0) {
          const block = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          const event = parseSseChunk(block);
          if (event !== undefined) {
            lastEventId = event.id;
            handlers.onEvent(event);
          }
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      // A read error is a dropped connection, not a bug.
    }
    reconnect('DISCONNECTED');
  }

  void connect();

  return {
    close: () => {
      closed = true;
      cancelReconnect?.();
      controller?.abort();
    },
    lastEventId: () => lastEventId,
  };
}
