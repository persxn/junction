import type { Clock } from '../../platform/time.js';
import type { Sleeper } from './types.js';

/**
 * The per-host politeness queue (§7.2: "max 1 concurrent request per host",
 * effective delay between them).
 *
 * Two promises are all it takes. `tail` serializes: every caller chains onto the
 * previous one, so a host never has two requests in flight however many adapters
 * or jobs ask at once. `readyAt` spaces: the next request waits until the
 * previous one *started* plus the delay.
 *
 * Measuring from the start rather than from the end is deliberate. A crawl-delay
 * is a rate limit on how often we knock, not a cooling-off period after a slow
 * answer; measuring from the end would let a fast host be hit at the delay and a
 * slow host at delay-plus-its-own-latency, which is the wrong way round.
 *
 * The key is scheme + host + port, the same key robots.txt is cached under: a
 * hackathon on its own Devfolio sub-domain is a different server with its own
 * robots.txt and its own patience.
 */
export function hostKey(url: URL): string {
  return `${url.protocol}//${url.host}`;
}

export interface HostQueueOptions {
  readonly clock: Clock;
  readonly sleep: Sleeper;
}

interface HostLane {
  /** Resolves when the previous request on this host has finished. */
  tail: Promise<void>;
  /** Unix ms before which the next request must not start. */
  readyAt: number;
}

export class HostQueue {
  readonly #lanes = new Map<string, HostLane>();
  readonly #clock: Clock;
  readonly #sleep: Sleeper;
  /** Tests assert on this: "the run waited 10 s, not 3". */
  readonly waits: number[] = [];

  constructor(options: HostQueueOptions) {
    this.#clock = options.clock;
    this.#sleep = options.sleep;
  }

  /**
   * Runs `work` as the only in-flight request for `key`, no sooner than
   * `delayMs` after the previous one started.
   *
   * The lane's `tail` is replaced *before* awaiting, so a second caller that
   * arrives mid-flight chains behind this one rather than racing it.
   */
  async run<T>(
    key: string,
    delayMs: number,
    work: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const lane = this.#lanes.get(key) ?? { tail: Promise.resolve(), readyAt: 0 };
    this.#lanes.set(key, lane);

    const previous = lane.tail;
    let release = (): void => undefined;
    lane.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    try {
      await previous;
      const wait = Math.max(0, lane.readyAt - this.#clock.now().getTime());
      this.waits.push(wait);
      if (wait > 0) {
        await this.#sleep(wait, signal);
      }
      lane.readyAt = this.#clock.now().getTime() + Math.max(0, delayMs);
      return await work();
    } finally {
      release();
    }
  }

  /** How many hosts have been spoken to. Used by the run's log line. */
  get size(): number {
    return this.#lanes.size;
  }
}
