import type { Logger } from 'pino';

export interface ShutdownHook {
  readonly name: string;
  readonly run: () => Promise<void> | void;
}

/**
 * Things that must be closed before the process exits, in reverse registration
 * order so a component is torn down before whatever it depends on. Empty for
 * now; the database (WP-04b) and the job runner (WP-09) register here.
 */
export class ShutdownRegistry {
  readonly #hooks: ShutdownHook[] = [];

  register(name: string, run: () => Promise<void> | void): void {
    this.#hooks.push({ name, run });
  }

  /** Registered names, oldest first. */
  get names(): readonly string[] {
    return this.#hooks.map((hook) => hook.name);
  }

  /**
   * Runs every hook newest-first. A hook that throws is logged and skipped: one
   * broken component must not keep the process alive.
   */
  async runAll(logger: Logger): Promise<void> {
    for (const hook of [...this.#hooks].reverse()) {
      try {
        await hook.run();
        logger.debug({ hook: hook.name }, 'shutdown hook finished');
      } catch (error) {
        logger.error({ err: error, hook: hook.name }, 'shutdown hook failed');
      }
    }
  }
}
