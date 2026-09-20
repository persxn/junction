import type {
  ScrapeTrigger,
  SourceRefreshResult,
  SourceStatus,
  SourceSummary,
  UpdateSourceRequest,
} from '@compintel/contracts';
import type { Logger } from 'pino';

import type { ScrapeRunRow, SourceRow } from '../../db/schema/index.js';
import { runScrape, type ScrapeRunDependencies } from '../../scraping/run.js';
import type { AdapterRegistry } from '../../sources/registry.js';
import { withAudit, type AuditLog } from '../../platform/audit.js';
import { conflict } from '../../platform/errors.js';
import { nowMs, systemClock, type Clock } from '../../platform/time.js';
import { assertCan } from '../auth/policy.js';
import type { Principal } from '../auth/types.js';
import { sourceNotFound, sourceRefreshTooSoon } from './errors.js';
import { nextManualRefreshAt, toRunSummary, toStatus, toSummary } from './mappers.js';
import type { SourceRecordsRepository } from './records.js';
import type { SourcesRepository } from './repository.js';

/**
 * Source administration and the manual refresh (§7.2, §10.2 `source.manage`).
 *
 * Two rules are enforced here and nowhere else, because a route is the wrong
 * place for either.
 *
 * **`compliance_status` is not editable.** It is not in `UpdateSourceRequest`,
 * it is not in `SourcePatch`, and there is no method that writes it. A verdict
 * comes from a person reading a site's Terms and lands as a data migration
 * (0006); a toggle on an admin screen that could turn Devpost on would make
 * every sentence in ADR-0016 a suggestion.
 *
 * **A manual refresh respects the floor** (D-27). An admin pressing Refresh
 * repeatedly is exactly the traffic pattern `manual_min_interval_minutes` was
 * written for.
 */

export interface SourcesServiceDependencies {
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly registry: AdapterRegistry;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly clock?: Clock;
  /** Everything `runScrape` needs except the source and the adapter. */
  readonly runtime: Omit<ScrapeRunDependencies, 'sources' | 'records' | 'clock' | 'logger'>;
}

export interface SourcesServiceContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export class SourcesService {
  readonly #deps: SourcesServiceDependencies;
  readonly #clock: Clock;

  constructor(dependencies: SourcesServiceDependencies) {
    this.#deps = dependencies;
    this.#clock = dependencies.clock ?? systemClock;
  }

  /** Readable by anyone signed in: "where did this event come from?" is not admin-only. */
  list(): readonly SourceSummary[] {
    return this.#deps.sources.list().map(toSummary);
  }

  status(): readonly SourceStatus[] {
    const now = nowMs(this.#clock);
    return this.#deps.sources.list().map((source) =>
      toStatus({
        source,
        state: this.#deps.sources.state(source.id, now),
        latestRun: this.#deps.sources.latestRun(source.id),
        now,
      }),
    );
  }

  statusOf(key: string): SourceStatus {
    const source = this.#require(key);
    const now = nowMs(this.#clock);
    return toStatus({
      source,
      state: this.#deps.sources.state(source.id, now),
      latestRun: this.#deps.sources.latestRun(source.id),
      now,
    });
  }

  /** Enable/disable, cadence, delay, caps — never the compliance verdict. */
  update(context: SourcesServiceContext, key: string, request: UpdateSourceRequest): SourceSummary {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    const { version, ...patch } = request;

    const updated = withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'source.updated',
        entityKind: 'source',
        entityId: source.id,
        summary: `Changed the ${source.name} source`,
        diff: { ...patch },
        requestId: context.requestId ?? null,
      },
      () => this.#deps.sources.update(source.id, patch, version, nowMs(this.#clock)),
    );
    if (updated === undefined) {
      throw conflict(
        `${source.name} was changed by somebody else while you were editing it.`,
        'Reload the source list and try again.',
      );
    }
    return toSummary(updated);
  }

  /**
   * An administrator asking for an update now.
   *
   * The floor is checked *before* the run is started rather than being handled
   * inside it, so a refused refresh leaves no `scrape_runs` row: nothing was
   * attempted, and a row saying otherwise would pollute the §7.6 count.
   */
  async refresh(context: SourcesServiceContext, key: string): Promise<SourceRefreshResult> {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    const now = nowMs(this.#clock);
    const state = this.#deps.sources.state(source.id, now);
    const allowedAt = nextManualRefreshAt(source, state);
    if (allowedAt !== null && allowedAt > now) {
      throw sourceRefreshTooSoon(source.key, new Date(allowedAt));
    }

    this.#deps.audit.append({
      actorKind: 'USER',
      actorUserId: context.actor.id,
      action: 'source.refreshed',
      entityKind: 'source',
      entityId: source.id,
      summary: `Asked ${source.name} for an update`,
      requestId: context.requestId ?? null,
    });

    const run = await this.run(source, 'MANUAL');
    return { run: toRunSummary(run, source.key), status: this.statusOf(source.key) };
  }

  /**
   * Runs one source. Shared by the scheduled job and the manual refresh, so the
   * two can never diverge on what a run does.
   *
   * A source with no registered adapter is a 409 rather than a failed run: in
   * WP-09a the registry is empty by design, and recording a failure for "we have
   * not written this adapter yet" would start a backoff ladder over our own
   * roadmap.
   */
  run(source: SourceRow, trigger: ScrapeTrigger, signal?: AbortSignal): Promise<ScrapeRunRow> {
    const adapter = this.#deps.registry.get(source.key);
    if (adapter === undefined) {
      throw conflict(
        `No adapter is registered for ${source.name} yet, so there is nothing to run.`,
        'This source is read manually until its adapter ships.',
      );
    }
    return runScrape(
      {
        ...this.#deps.runtime,
        sources: this.#deps.sources,
        records: this.#deps.records,
        clock: this.#clock,
        logger: this.#deps.logger,
      },
      { source, adapter, trigger, ...(signal === undefined ? {} : { signal }) },
    );
  }

  /** Sources with an adapter, approved and switched on — the ones that get a job (R22). */
  runnable(): readonly SourceRow[] {
    return this.#deps.sources
      .list()
      .filter(
        (source) =>
          source.isEnabled &&
          this.#deps.registry.has(source.key) &&
          (source.complianceStatus === 'APPROVED' ||
            source.complianceStatus === 'APPROVED_WITH_LIMITS'),
      );
  }

  byKey(key: string): SourceRow | undefined {
    return this.#deps.sources.findByKey(key);
  }

  #require(key: string): SourceRow {
    const source = this.#deps.sources.findByKey(key);
    if (source === undefined) {
      throw sourceNotFound(key);
    }
    return source;
  }
}
