import {
  EventCandidate,
  type EventImportResult,
  type ManualEventInput,
  type OverrideField,
  type UrlImportCommitRequest,
  type UrlImportRequest,
  type UrlImportResult,
} from '@compintel/contracts';
import type { Logger } from 'pino';

import type { SourceRow } from '../../../db/schema/index.js';
import { manualRecordUrl, rawFromManual, statedFields } from '../../../domain/import/candidate.js';
import { normalizeCandidate } from '../../../domain/normalize/index.js';
import type { AuditLog } from '../../../platform/audit.js';
import { uuid7 } from '../../../platform/ids.js';
import { nowMs, systemClock, type Clock } from '../../../platform/time.js';
import type { ScrapingHttp, SourceCredential } from '../../../scraping/http/index.js';
import type { SnapshotStore } from '../../../scraping/snapshots.js';
import type { AdapterRegistry } from '../../../sources/registry.js';
import { assertCan } from '../../auth/policy.js';
import type { Principal } from '../../auth/types.js';
import type { Geocoder } from '../../geo/geocoder.js';
import { sourceNotFound } from '../../sources/errors.js';
import type { SourceRecordsRepository } from '../../sources/records.js';
import type { SourcesRepository } from '../../sources/repository.js';
import type { EventLinker } from '../link.js';
import type { ProvenanceRepository } from '../provenance.js';
import type { EventResolver } from '../resolver.js';
import { importDomainManualOnly, importRateLimited } from './errors.js';
import { previewImport, type PreviewedImport } from './preview.js';
import { PreviewCache } from './preview-cache.js';
import { writeImportedEvent } from './write.js';

/**
 * Manual event creation and URL import (§10.2 "add manual events; URL import",
 * D-30, WP-14).
 *
 * Three calls, one write path. `preview` reads and writes nothing; `commit`
 * writes what the professor reviewed; `createManual` writes what they typed.
 * The last two end in the same function, because "I read this off a page and
 * corrected it" and "I know this event" are the same claim as far as §7.5 is
 * concerned: a person stated it, so it becomes an override that survives every
 * later scrape.
 *
 * The preview is rate-limited per user. §7.1 calls URL import *user-initiated*,
 * and a limit is what keeps a stuck screen from turning into a crawler.
 */

export const MANUAL_SOURCE_KEY = 'manual';
export const URL_IMPORT_SOURCE_KEY = 'url-import';

/** §7.1: ten pages a minute is more than a person reviewing each one can use. */
export const DEFAULT_PREVIEWS_PER_MINUTE = 10;

export interface ImportServiceDependencies {
  readonly sources: SourcesRepository;
  readonly records: SourceRecordsRepository;
  readonly linker: EventLinker;
  readonly provenance: ProvenanceRepository;
  readonly resolver: EventResolver;
  readonly geocoder: Pick<Geocoder, 'resolve'>;
  readonly registry: AdapterRegistry;
  readonly http: ScrapingHttp;
  readonly audit: AuditLog;
  readonly logger: Logger;
  readonly clock?: Clock;
  readonly snapshots?: SnapshotStore;
  /** WP-11/R74: an API key or the professor's own session, per source. */
  readonly credentials?: (source: SourceRow) => SourceCredential | undefined;
  readonly previewsPerMinute?: number;
  /** WP-15a: called after every successful write, so the typo vocabulary sees the event. */
  readonly onIngested?: () => void;
}

export interface ImportServiceContext {
  readonly actor: Principal;
  readonly requestId?: string | undefined;
}

export class EventImportService {
  readonly #deps: ImportServiceDependencies;
  readonly #clock: Clock;
  readonly #previews: PreviewCache;
  readonly #perMinute: number;
  /** Preview timestamps per user, for the rate limit. */
  readonly #recent = new Map<string, number[]>();

  constructor(deps: ImportServiceDependencies) {
    this.#deps = deps;
    this.#clock = deps.clock ?? systemClock;
    this.#previews = new PreviewCache(this.#clock);
    this.#perMinute = deps.previewsPerMinute ?? DEFAULT_PREVIEWS_PER_MINUTE;
  }

  /** Reads at most one page and writes nothing (WP-14 step 7). */
  async preview(
    context: ImportServiceContext,
    request: UrlImportRequest,
  ): Promise<UrlImportResult> {
    assertCan(context.actor, 'event.import_url');
    this.#throttle(context.actor.id);
    const rows = this.#deps.sources.list();
    const outcome = await previewImport(
      {
        registry: this.#deps.registry,
        http: this.#deps.http,
        clock: this.#clock,
        logger: this.#deps.logger,
        ...(this.#deps.credentials === undefined ? {} : { credentials: this.#deps.credentials }),
      },
      rows,
      this.#row(URL_IMPORT_SOURCE_KEY),
      request.url,
    );
    if (outcome.previewed !== undefined) {
      this.#previews.put(context.actor.id, outcome.result.url, outcome.previewed);
    }
    return outcome.result;
  }

  /**
   * Saves a reviewed import.
   *
   * The URL is dispatched again rather than trusted: a client that asks to
   * commit a Devpost link as a `GENERIC` import is refused here, whatever it
   * said in the request, and no page is ever read on the way.
   */
  async commit(
    context: ImportServiceContext,
    request: UrlImportCommitRequest,
  ): Promise<EventImportResult> {
    assertCan(context.actor, 'event.import_url');
    const previewed = await this.#committedCandidate(context, request);
    const source = this.#row(previewed.sourceKey);
    const reviewed = this.#reviewed(request.fields, {
      sourceKey: previewed.sourceKey,
      externalKey: previewed.candidate.externalKey,
      url: previewed.candidate.url,
    });
    const edited = request.edited.filter((field) => field.length > 0);
    return this.#write({
      context,
      source,
      candidate: previewed.candidate,
      overrideValues: reviewed,
      overrideFields: edited,
      overrideReason: 'URL import review',
      action: 'event.imported.url',
      raw: previewed.raw,
    });
  }

  /** An event a professor typed in (§10.2, `event.create_manual`). */
  createManual(context: ImportServiceContext, input: ManualEventInput): EventImportResult {
    assertCan(context.actor, 'event.create_manual');
    const source = this.#row(MANUAL_SOURCE_KEY);
    const externalKey = `manual:${uuid7()}`;
    const candidate = this.#reviewed(input, {
      sourceKey: source.key,
      externalKey,
      url: input.officialUrl ?? input.registrationUrl ?? manualRecordUrl(externalKey),
    });
    return this.#write({
      context,
      source,
      candidate,
      overrideValues: candidate,
      overrideFields: statedFields(input),
      overrideReason: 'manual entry',
      action: 'event.created.manual',
    });
  }

  /** One write, whichever door it came through. */
  #write(input: {
    context: ImportServiceContext;
    source: SourceRow;
    candidate: EventCandidate;
    overrideValues: EventCandidate;
    overrideFields: readonly OverrideField[];
    overrideReason: string;
    action: string;
    raw?: Uint8Array | undefined;
  }): EventImportResult {
    const at = nowMs(this.#clock);
    const snapshotRef =
      input.raw === undefined
        ? undefined
        : this.#deps.snapshots?.write(input.source.key, input.candidate.externalKey, input.raw);
    const result = writeImportedEvent(
      {
        records: this.#deps.records,
        linker: this.#deps.linker,
        provenance: this.#deps.provenance,
        resolver: this.#deps.resolver,
        geocoder: this.#deps.geocoder,
        audit: this.#deps.audit,
      },
      {
        source: input.source,
        candidate: input.candidate,
        overrideCandidate: input.overrideValues,
        overrideFields: input.overrideFields,
        overrideReason: input.overrideReason,
        actorId: input.context.actor.id,
        actorName: input.context.actor.displayName,
        action: input.action,
        ...(input.context.requestId === undefined ? {} : { requestId: input.context.requestId }),
        ...(snapshotRef === undefined ? {} : { rawSnapshotRef: snapshotRef }),
        at,
      },
    );
    this.#deps.onIngested?.();
    return result;
  }

  /** The professor's values, normalized exactly as a source's would be. */
  #reviewed(
    fields: ManualEventInput,
    identity: { sourceKey: string; externalKey: string; url: string },
  ): EventCandidate {
    const raw = rawFromManual(identity, fields, this.#clock);
    const { candidate } = normalizeCandidate(raw, {
      clock: this.#clock,
      ...(fields.timezone === undefined ? {} : { sourceTimezone: fields.timezone }),
      ...(fields.eventType === undefined ? {} : { sourceEventType: fields.eventType }),
    });
    return EventCandidate.parse(candidate);
  }

  /**
   * What the commit writes as the source's own record.
   *
   * The preview this commit belongs to, when it is still cached — so one import
   * is one request to somebody else's server. When it is not (a restart, a long
   * pause), an approved source is read once more, and a generic page is not:
   * its record is the professor's reviewed entry, which is what they approved.
   */
  async #committedCandidate(
    context: ImportServiceContext,
    request: UrlImportCommitRequest,
  ): Promise<PreviewedImport> {
    const cached = this.#previews.get(context.actor.id, request.url);
    if (cached !== undefined) {
      return cached;
    }
    const rows = this.#deps.sources.list();
    const outcome = await previewImport(
      {
        registry: this.#deps.registry,
        http: this.#deps.http,
        clock: this.#clock,
        logger: this.#deps.logger,
        ...(this.#deps.credentials === undefined ? {} : { credentials: this.#deps.credentials }),
      },
      rows,
      this.#row(URL_IMPORT_SOURCE_KEY),
      request.url,
    );
    if (outcome.result.disposition === 'MANUAL_ONLY') {
      throw importDomainManualOnly(outcome.result.reason ?? 'That site is not read automatically.');
    }
    if (outcome.previewed === undefined) {
      throw importDomainManualOnly('Nothing could be read from that link.');
    }
    return outcome.previewed;
  }

  #row(key: string): SourceRow {
    const row = this.#deps.sources.findByKey(key);
    if (row === undefined) {
      throw sourceNotFound(key);
    }
    return row;
  }

  /** Ten previews a minute per user (§7.1: user-initiated, one page at a time). */
  #throttle(userId: string): void {
    const now = nowMs(this.#clock);
    const recent = (this.#recent.get(userId) ?? []).filter((at) => now - at < 60_000);
    if (recent.length >= this.#perMinute) {
      throw importRateLimited(this.#perMinute);
    }
    recent.push(now);
    this.#recent.set(userId, recent);
  }
}
