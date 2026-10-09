import type { StreamEvent, StreamEventType } from '@compintel/contracts';
import { nowMs, systemClock, type Clock } from './time.js';

/**
 * The server half of `/api/v1/stream` (ruling R36, ADR-0017, §4.4).
 *
 * One hub for the whole process. It holds a monotonic counter, a small replay
 * buffer and the set of open subscribers, and it knows nothing about HTTP — the
 * route turns what it emits into `text/event-stream` bytes, which is what lets
 * the ordering, the replay and the heartbeat be tested without a socket.
 *
 * The buffer is deliberately tiny. It exists so a client that reconnects within
 * seconds does not miss an invalidation, not so it can be offline for an hour
 * and catch up: a client that has fallen further behind than the buffer is told
 * to re-read, which it does by invalidating everything.
 */

/** Newest events kept for `Last-Event-ID` replay (R36). */
export const REPLAY_MAX_EVENTS = 200;

/** …and no older than this, whichever is smaller (R36). */
export const REPLAY_MAX_AGE_MS = 5 * 60_000;

/** A comment line every 15 s, so a dead connection is noticed (R36). */
export const HEARTBEAT_INTERVAL_MS = 15_000;

interface BufferedEvent {
  readonly event: StreamEvent;
  readonly at: number;
  /** A user id: only that user's streams see it (WP-23). Undefined = everyone. */
  readonly audience?: string;
}

export interface Subscriber {
  /** Called for every event after the one the subscriber last saw. */
  readonly send: (event: StreamEvent) => void;
  /** Called when the backend is shutting down; the route ends the response. */
  readonly close: () => void;
  /** Whose stream this is; user-scoped events reach only their user (WP-23). */
  readonly userId?: string;
}

const reaches = (audience: string | undefined, userId: string | undefined): boolean =>
  audience === undefined || audience === userId;

export interface StreamHubOptions {
  readonly clock?: Clock;
  readonly maxEvents?: number;
  readonly maxAgeMs?: number;
}

export class StreamHub {
  readonly #clock: Clock;
  readonly #maxEvents: number;
  readonly #maxAgeMs: number;
  readonly #subscribers = new Set<Subscriber>();
  #buffer: BufferedEvent[] = [];
  #lastId = 0;
  #closed = false;

  constructor(options: StreamHubOptions = {}) {
    this.#clock = options.clock ?? systemClock;
    this.#maxEvents = options.maxEvents ?? REPLAY_MAX_EVENTS;
    this.#maxAgeMs = options.maxAgeMs ?? REPLAY_MAX_AGE_MS;
  }

  /** Milliseconds since the epoch, the shape every timestamp column wants. */
  get #nowMs(): number {
    return nowMs(this.#clock);
  }

  get lastEventId(): number {
    return this.#lastId;
  }

  get subscriberCount(): number {
    return this.#subscribers.size;
  }

  /**
   * Publishes an event to every open stream — or, with `audience`, only to that
   * user's streams (notifications, WP-23) — and remembers it for replay.
   */
  publish(
    type: StreamEventType,
    payload: Readonly<Record<string, unknown>> = {},
    audience?: string,
  ): StreamEvent {
    this.#lastId += 1;
    const event: StreamEvent = { id: this.#lastId, type, payload: { ...payload } };
    this.#buffer.push(
      audience === undefined ? { event, at: this.#nowMs } : { event, at: this.#nowMs, audience },
    );
    this.#prune();
    for (const subscriber of this.#subscribers) {
      if (reaches(audience, subscriber.userId)) {
        subscriber.send(event);
      }
    }
    return event;
  }

  #prune(): void {
    const cutoff = this.#nowMs - this.#maxAgeMs;
    this.#buffer = this.#buffer.filter((entry) => entry.at >= cutoff).slice(-this.#maxEvents);
  }

  /**
   * Everything after `lastEventId`, oldest first. An id older than anything
   * still buffered comes back empty — the caller cannot be caught up, and the
   * honest answer is to let it re-read rather than invent history.
   */
  replay(lastEventId: number | undefined, userId?: string): readonly StreamEvent[] {
    this.#prune();
    if (lastEventId === undefined || lastEventId <= 0) {
      return [];
    }
    const oldest = this.#buffer[0]?.event.id;
    if (oldest === undefined || lastEventId + 1 < oldest) {
      return [];
    }
    return this.#buffer
      .filter((entry) => entry.event.id > lastEventId && reaches(entry.audience, userId))
      .map((entry) => entry.event);
  }

  /** True when the caller asked to resume from an id the buffer no longer has. */
  replayGap(lastEventId: number | undefined): boolean {
    if (lastEventId === undefined || lastEventId <= 0) {
      return false;
    }
    this.#prune();
    const oldest = this.#buffer[0]?.event.id;
    if (oldest === undefined) {
      return lastEventId < this.#lastId;
    }
    return lastEventId + 1 < oldest;
  }

  subscribe(subscriber: Subscriber): () => void {
    if (this.#closed) {
      subscriber.close();
      return () => undefined;
    }
    this.#subscribers.add(subscriber);
    return () => {
      this.#subscribers.delete(subscriber);
    };
  }

  /**
   * The `streams`-phase shutdown hook (R14/R36): every open response is ended
   * politely *before* `server.close()`, which would otherwise wait on them.
   */
  closeAll(): void {
    this.#closed = true;
    for (const subscriber of [...this.#subscribers]) {
      subscriber.close();
    }
    this.#subscribers.clear();
  }

  get isClosed(): boolean {
    return this.#closed;
  }
}

/** One event as `text/event-stream` bytes. */
export function formatSseEvent(event: StreamEvent): string {
  return `id: ${String(event.id)}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
}

/** The heartbeat: a comment, which every SSE parser ignores. */
export const SSE_HEARTBEAT = ': keep-alive\n\n';

/** Reads `Last-Event-ID`, tolerating the rubbish a proxy might put there. */
export function parseLastEventId(header: string | string[] | undefined): number | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (raw === undefined) {
    return undefined;
  }
  const parsed = Number.parseInt(raw, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}
