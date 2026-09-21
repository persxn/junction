import type { Logger } from 'pino';

import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { classify, prepareRules, type PreparedRule } from './domain/classify.js';
import type { CategoriesRepository, ClassificationInput } from './repo.js';

/**
 * Applying the rules (WP-15b step 4).
 *
 * - **On ingest:** the resolver calls {@link classifyEvent} after every
 *   resolution — scrape, auto-merge, manual entry, URL import, merge and
 *   unmerge all end there — inside the same transaction, so an event is never
 *   visible with categories from before its latest change.
 * - **After a rule edit:** {@link requestReclassification} records a run, and
 *   {@link processPending} works through every non-merged event in chunks of
 *   {@link RECLASSIFY_CHUNK} rows, one short transaction per chunk, yielding to
 *   the event loop between chunks. Each chunk commits its position with its
 *   assignments, so a restart resumes where it stopped; no statement touches
 *   the whole table at once.
 *
 * Neither path ever writes over a MANUAL row or a suppression
 * (`CategoriesRepository.replaceAutomatic`).
 */

export const RECLASSIFY_CHUNK = 250;

export interface ClassifierDependencies {
  readonly repo: CategoriesRepository;
  readonly logger?: Logger;
  readonly clock?: Clock;
  /** Called after a run is recorded — `main.ts` triggers the job so it starts now, not at the next tick. */
  readonly onRunRequested?: () => void;
}

export interface ReclassifyProgress {
  readonly runId: string | undefined;
  readonly events: number;
  readonly changed: number;
  readonly finished: boolean;
}

export class CategoryClassifier {
  readonly #deps: ClassifierDependencies;
  readonly #clock: Clock;
  #rules: PreparedRule[] | undefined;

  constructor(deps: ClassifierDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
  }

  /** The active rules, compiled once; dropped by {@link rulesChanged}. */
  rules(): readonly PreparedRule[] {
    this.#rules ??= prepareRules(this.#deps.repo.activeRules());
    return this.#rules;
  }

  rulesChanged(): void {
    this.#rules = undefined;
  }

  /** Re-derives one event's automatic categories. Returns whether any row changed. */
  classifyEvent(eventId: string, at: number = nowMs(this.#clock)): boolean {
    const input = this.#deps.repo.classificationInput(eventId);
    return input === undefined ? false : this.#apply(input, at);
  }

  #apply(input: ClassificationInput, at: number): boolean {
    const computed = classify(input, input.sourceTags, this.rules());
    return this.#deps.repo.replaceAutomatic(input.id, computed, at);
  }

  requestReclassification(reason: string, userId: string | null): string {
    this.rulesChanged();
    const id = this.#deps.repo.requestRun(reason, userId, nowMs(this.#clock));
    this.#deps.logger?.info({ runId: id, reason }, 'category re-classification requested');
    this.#deps.onRunRequested?.();
    return id;
  }

  /**
   * Works the newest pending run to its end, or until `signal` aborts or
   * `maxChunks` have been done. Safe to call when nothing is pending.
   */
  async processPending(
    options: { signal?: AbortSignal; maxChunks?: number; chunkSize?: number } = {},
  ): Promise<ReclassifyProgress> {
    const { repo } = this.#deps;
    const run = repo.pendingRun();
    if (run === undefined) {
      return { runId: undefined, events: 0, changed: 0, finished: true };
    }
    const size = options.chunkSize ?? RECLASSIFY_CHUNK;
    let after = run.afterRowid;
    let done = run.eventsDone;
    let changed = 0;
    let chunks = 0;
    for (;;) {
      if (
        options.signal?.aborted === true ||
        (options.maxChunks !== undefined && chunks >= options.maxChunks)
      ) {
        return { runId: run.id, events: done, changed, finished: false };
      }
      const at = nowMs(this.#clock);
      const finished = repo.raw.transaction((): boolean => {
        // Another request may have superseded this run between chunks.
        if (repo.pendingRun()?.id !== run.id) return true;
        const inputs = repo.chunk(after, size);
        for (const input of inputs) if (this.#apply(input, at)) changed += 1;
        done += inputs.length;
        const last = inputs[inputs.length - 1];
        if (last !== undefined) after = last.rowid;
        const end = inputs.length < size;
        repo.advanceRun(run.id, after, done, end ? at : null);
        return end;
      })();
      chunks += 1;
      if (finished) {
        this.#deps.logger?.info(
          { runId: run.id, events: done, changed },
          'category re-classification finished',
        );
        return { runId: run.id, events: done, changed, finished: true };
      }
      this.#deps.logger?.debug({ runId: run.id, events: done }, 'category re-classification chunk');
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
}
