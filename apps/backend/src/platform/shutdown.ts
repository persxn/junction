import type { Logger } from 'pino';

/**
 * Ruling R14. `streams` hooks run **before** the HTTP server stops accepting, so
 * anything holding a response open (SSE from WP-07a, long downloads) can end it
 * politely instead of being cut off. `resources` hooks run **after** the server
 * is closed, when nothing can still issue queries: the database, the job runner
 * and the LLM sidecar.
 */
export const SHUTDOWN_PHASES = ['streams', 'resources'] as const;
export type ShutdownPhase = (typeof SHUTDOWN_PHASES)[number];

export interface ShutdownHook {
  readonly phase: ShutdownPhase;
  readonly name: string;
  readonly run: () => Promise<void> | void;
}

/**
 * Things that must be closed before the process exits. Within a phase hooks run
 * in reverse registration order, so a component is torn down before whatever it
 * depends on.
 */
export class ShutdownRegistry {
  readonly #hooks: ShutdownHook[] = [];

  register(phase: ShutdownPhase, name: string, run: () => Promise<void> | void): void {
    this.#hooks.push({ phase, name, run });
  }

  /** Registered names, oldest first; optionally limited to one phase. */
  names(phase?: ShutdownPhase): readonly string[] {
    return this.#hooks
      .filter((hook) => phase === undefined || hook.phase === phase)
      .map((hook) => hook.name);
  }

  /**
   * Runs one phase, newest hook first. A hook that throws is logged and the rest
   * still run — one broken component must not keep the process alive — but the
   * count of failures comes back so `main.ts` can exit 1 (R14).
   */
  async runPhase(phase: ShutdownPhase, logger: Logger): Promise<number> {
    let failures = 0;
    for (const hook of this.#hooks.filter((hook) => hook.phase === phase).reverse()) {
      try {
        await hook.run();
        logger.debug({ phase, hook: hook.name }, 'shutdown hook finished');
      } catch (error) {
        failures += 1;
        logger.error({ err: error, phase, hook: hook.name }, 'shutdown hook failed');
      }
    }
    return failures;
  }
}
