import type { ScrapeErrorKind, ScrapeOutcome, ScrapeTrigger } from '@compintel/contracts';
import { and, desc, eq, gt, sql } from 'drizzle-orm';

import {
  scrapeRuns,
  sources,
  sourceState,
  type ScrapeRunRow,
  type SourceRow,
  type SourceStateRow,
} from '../../db/schema/index.js';
import type { DatabaseHandle } from '../../platform/db.js';
import { uuid7 } from '../../platform/ids.js';

/**
 * Reads and writes for `sources`, `source_state` and `scrape_runs`.
 *
 * `source_records` is next door in `records.ts`: it is the only one of the four
 * tables that is written per item rather than per run, and keeping its
 * transaction boundary visible on its own is worth the extra file.
 */

/** What an admin may change (§10.2). `complianceStatus` is not in the list. */
export interface SourcePatch {
  readonly isEnabled?: boolean | undefined;
  readonly cadenceMinutes?: number | undefined;
  readonly manualMinIntervalMinutes?: number | undefined;
  readonly minDelayMs?: number | undefined;
  readonly maxRequestsPerRun?: number | undefined;
}

/**
 * The only columns {@link SourcesRepository.update} will write. A closed list
 * rather than "whatever the patch object has", so a field that is not here
 * cannot reach the table however it got into the object.
 */
export const SOURCE_PATCH_FIELDS = [
  'isEnabled',
  'cadenceMinutes',
  'manualMinIntervalMinutes',
  'minDelayMs',
  'maxRequestsPerRun',
] as const satisfies readonly (keyof SourcePatch)[];

/** The counters a finished run reports. */
export interface RunTotals {
  readonly outcome: ScrapeOutcome;
  readonly errorKind?: ScrapeErrorKind | null;
  readonly errorDetail?: string | null;
  readonly listingComplete: boolean;
  readonly requestsMade: number;
  readonly itemsSeen: number;
  readonly itemsNew: number;
  readonly itemsUpdated: number;
  readonly itemsUnchanged: number;
  readonly itemsInvalid: number;
}

export class SourcesRepository {
  readonly #db: DatabaseHandle;

  constructor(db: DatabaseHandle) {
    this.#db = db;
  }

  /** Alphabetical by key, which is also the order Source status shows them in. */
  list(): readonly SourceRow[] {
    return this.#db.drizzle.select().from(sources).orderBy(sources.key).all();
  }

  findByKey(key: string): SourceRow | undefined {
    return this.#db.drizzle.select().from(sources).where(eq(sources.key, key)).get();
  }

  findById(id: string): SourceRow | undefined {
    return this.#db.drizzle.select().from(sources).where(eq(sources.id, id)).get();
  }

  /**
   * Applies a patch if `expectedVersion` still matches, bumping `version`.
   * Returns `undefined` when it does not — §6.1's optimistic concurrency, which
   * the route turns into a 409.
   */
  update(
    id: string,
    patch: SourcePatch,
    expectedVersion: number,
    at: number,
  ): SourceRow | undefined {
    // The five fields are named one at a time rather than spread. Spreading
    // would make this method write whatever it was handed, which is one type
    // assertion away from an admin API that can approve Devpost — and the
    // compliance verdict is not an administrator's to change (D-26, §10.2).
    const allowed: Record<string, unknown> = {};
    for (const field of SOURCE_PATCH_FIELDS) {
      const value = patch[field];
      if (value !== undefined) {
        allowed[field] = value;
      }
    }
    const changed = this.#db.drizzle
      .update(sources)
      .set({ ...allowed, updatedAt: at, version: sql`${sources.version} + 1` })
      .where(and(eq(sources.id, id), eq(sources.version, expectedVersion)))
      .run();
    return changed.changes === 0 ? undefined : this.findById(id);
  }

  /**
   * Switches a source off without an admin doing it — §7.7's response to
   * `PARSE`/`SCHEMA_CHANGED`. Separate from {@link update} because it must not
   * fail on a version mismatch: it is the system reacting, not a person editing.
   */
  pause(id: string, at: number): void {
    this.#db.drizzle
      .update(sources)
      .set({ isEnabled: false, updatedAt: at, version: sql`${sources.version} + 1` })
      .where(eq(sources.id, id))
      .run();
  }

  /** The health row, created on demand so a hand-inserted source still works. */
  state(sourceId: string, now: number): SourceStateRow {
    const existing = this.#db.drizzle
      .select()
      .from(sourceState)
      .where(eq(sourceState.sourceId, sourceId))
      .get();
    if (existing !== undefined) {
      return existing;
    }
    const row: SourceStateRow = {
      sourceId,
      lastRunAt: null,
      lastSuccessAt: null,
      nextDueAt: now,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastErrorKind: null,
      lastErrorMessage: null,
    };
    this.#db.drizzle.insert(sourceState).values(row).onConflictDoNothing().run();
    return row;
  }

  #setState(sourceId: string, patch: Partial<SourceStateRow>): void {
    this.#db.drizzle.update(sourceState).set(patch).where(eq(sourceState.sourceId, sourceId)).run();
  }

  /**
   * A run that did not fail. Clears the failure streak and the backoff: R59's
   * ladder is about *consecutive* failures, and one success ends the sequence
   * however long it was.
   */
  recordSuccess(sourceId: string, at: number, nextDueAt: number, countsAsSuccess: boolean): void {
    this.#setState(sourceId, {
      lastRunAt: at,
      ...(countsAsSuccess ? { lastSuccessAt: at } : {}),
      nextDueAt,
      consecutiveFailures: 0,
      backoffUntil: null,
      lastErrorKind: null,
      lastErrorMessage: null,
    });
  }

  /** A failure: the streak grows and the source is left alone until `backoffUntil`. */
  recordFailure(
    sourceId: string,
    at: number,
    backoffUntil: number,
    errorKind: ScrapeErrorKind,
    errorMessage: string,
    failures: number,
  ): void {
    this.#setState(sourceId, {
      lastRunAt: at,
      nextDueAt: backoffUntil,
      consecutiveFailures: failures,
      backoffUntil,
      lastErrorKind: errorKind,
      lastErrorMessage: errorMessage,
    });
  }

  /**
   * Opens a run row. Nothing is written to `source_state` here: a skipped run —
   * offline, or still in backoff — must leave the streak, the backoff and
   * `last_run_at` alone, or "last tried" would come to mean "last woke up".
   */
  openRun(sourceId: string, trigger: ScrapeTrigger, startedAt: number): ScrapeRunRow {
    const row = {
      id: uuid7(),
      sourceId,
      trigger,
      startedAt,
      finishedAt: null,
      // Every run starts pessimistic: a process killed mid-run leaves FAILED
      // behind rather than a row that claims success it never reported.
      outcome: 'FAILED' as ScrapeOutcome,
      errorKind: null,
      errorDetail: null,
      listingComplete: false,
      requestsMade: 0,
      itemsSeen: 0,
      itemsNew: 0,
      itemsUpdated: 0,
      itemsUnchanged: 0,
      itemsInvalid: 0,
      durationMs: null,
    };
    this.#db.drizzle.insert(scrapeRuns).values(row).run();
    return row;
  }

  closeRun(runId: string, finishedAt: number, startedAt: number, totals: RunTotals): ScrapeRunRow {
    this.#db.drizzle
      .update(scrapeRuns)
      .set({
        finishedAt,
        durationMs: Math.max(0, finishedAt - startedAt),
        outcome: totals.outcome,
        errorKind: totals.errorKind ?? null,
        errorDetail: totals.errorDetail ?? null,
        listingComplete: totals.listingComplete,
        requestsMade: totals.requestsMade,
        itemsSeen: totals.itemsSeen,
        itemsNew: totals.itemsNew,
        itemsUpdated: totals.itemsUpdated,
        itemsUnchanged: totals.itemsUnchanged,
        itemsInvalid: totals.itemsInvalid,
      })
      .where(eq(scrapeRuns.id, runId))
      .run();
    const row = this.#db.drizzle.select().from(scrapeRuns).where(eq(scrapeRuns.id, runId)).get();
    if (row === undefined) {
      throw new Error(`Scrape run ${runId} vanished while it was being closed.`);
    }
    return row;
  }

  /** The newest run for a source; Source status reads its outcome and message. */
  latestRun(sourceId: string): ScrapeRunRow | undefined {
    return this.#db.drizzle
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.sourceId, sourceId))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(1)
      .get();
  }

  /** Every run for a source, newest first. Used by the tests and by WP-30. */
  runs(sourceId: string, limit = 50): readonly ScrapeRunRow[] {
    return this.#db.drizzle
      .select()
      .from(scrapeRuns)
      .where(eq(scrapeRuns.sourceId, sourceId))
      .orderBy(desc(scrapeRuns.startedAt))
      .limit(limit)
      .all();
  }

  /**
   * §7.6's counter: complete listing runs that started after `since`. A PARTIAL
   * run is excluded by `listing_complete`, so "partial runs never count" needs
   * no separate rule.
   */
  countCompleteRunsSince(sourceId: string, since: number): number {
    const row = this.#db.drizzle
      .select({ total: sql<number>`count(*)` })
      .from(scrapeRuns)
      .where(
        and(
          eq(scrapeRuns.sourceId, sourceId),
          eq(scrapeRuns.listingComplete, true),
          gt(scrapeRuns.startedAt, since),
        ),
      )
      .get();
    return row?.total ?? 0;
  }
}
