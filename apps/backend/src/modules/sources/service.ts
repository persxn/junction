import type {
  ScrapeTrigger,
  SetSourceSessionRequest,
  SourceRefreshResult,
  SourceSessionStatus,
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
import type { SettingsStore } from '../../platform/settings.js';
import { authConfigOf, credentialIsSet, storeCredential } from './credentials.js';
import { sourceNotFound, sourceRefreshTooSoon } from './errors.js';
import { nextManualRefreshAt, toRunSummary, toStatus, toSummary } from './mappers.js';
import { clearSession, sessionConfigOf, sessionStatus, storeSession } from './session.js';
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
  /** WP-11: where source credentials live (secret settings). */
  readonly settings?: SettingsStore;
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

  /** Whether a source's credential is set — never what it is (WP-11). */
  credentialStatus(context: SourcesServiceContext, key: string): { isSet: boolean } {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    return { isSet: credentialIsSet(source, this.#settings()) };
  }

  /**
   * Stores a source's credential (WP-11, U4). Audited without the values: the
   * audit row says who set it and when, and nothing else leaves this call.
   */
  setCredential(
    context: SourcesServiceContext,
    key: string,
    value: { readonly username: string; readonly apiKey: string },
  ): { isSet: boolean } {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    if (authConfigOf(source) === undefined) {
      throw conflict(
        `${source.name} does not use an API credential.`,
        'Only sources whose configuration names a credential accept one.',
      );
    }
    const settings = this.#settings();
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'source.credential.set',
        entityKind: 'source',
        entityId: source.id,
        summary: `Stored the ${source.name} API credential`,
        diff: {},
        requestId: context.requestId ?? null,
      },
      () => storeCredential(source, settings, value, context.actor.id),
    );
    return { isSet: credentialIsSet(source, settings) };
  }

  /** Whether the app holds the professor's own session for a source (R74). */
  sessionStatus(context: SourcesServiceContext, key: string): SourceSessionStatus {
    assertCan(context.actor, 'source.manage');
    return sessionStatus(this.#require(key), this.#settings());
  }

  /**
   * Stores the professor's own session (R74/D-34), pasted or captured by the
   * packaged sign-in window.
   *
   * Audited without the value — who signed in to what, and when — because an
   * administrator can export the audit log, and a cookie in it would be a
   * credential in a file somebody e-mails.
   */
  setSession(
    context: SourcesServiceContext,
    key: string,
    request: SetSourceSessionRequest,
  ): SourceSessionStatus {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    if (sessionConfigOf(source) === undefined) {
      throw conflict(
        `${source.name} is not a source you can sign in to.`,
        'Only sources whose verdict allows signed-in reading accept a session (R74).',
      );
    }
    const settings = this.#settings();
    const at = nowMs(this.#clock);
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'source.session.set',
        entityKind: 'source',
        entityId: source.id,
        summary: `Stored a ${source.name} session for ${context.actor.displayName}`,
        diff: { capturedVia: request.capturedVia },
        requestId: context.requestId ?? null,
      },
      () => storeSession(source, settings, request.cookie, context.actor.id, at),
    );
    return sessionStatus(source, settings);
  }

  /** Signs the app out of a source; the next run reads its public pages. */
  clearSession(context: SourcesServiceContext, key: string): SourceSessionStatus {
    assertCan(context.actor, 'source.manage');
    const source = this.#require(key);
    const settings = this.#settings();
    withAudit(
      this.#deps.audit,
      {
        actorKind: 'USER',
        actorUserId: context.actor.id,
        action: 'source.session.cleared',
        entityKind: 'source',
        entityId: source.id,
        summary: `Removed the stored ${source.name} session`,
        diff: {},
        requestId: context.requestId ?? null,
      },
      () => clearSession(source, settings, context.actor.id),
    );
    return sessionStatus(source, settings);
  }

  #settings(): SettingsStore {
    if (this.#deps.settings === undefined) {
      throw new Error('source credentials are not available on this backend');
    }
    return this.#deps.settings;
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
