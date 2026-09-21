import type {
  EventCandidate,
  EventImportResult,
  OverrideField,
  ParseWarning,
} from '@compintel/contracts';

import type { SourceRow } from '../../../db/schema/index.js';
import { claimValues } from '../../../domain/events/claims.js';
import { withAudit, type AuditLog } from '../../../platform/audit.js';
import type { Geocoder } from '../../geo/geocoder.js';
import { payloadHash, type SourceRecordsRepository } from '../../sources/records.js';
import type { EventLinker } from '../link.js';
import type { ProvenanceRepository } from '../provenance.js';
import type { EventResolver } from '../resolver.js';

/**
 * Saving an event a person stated: the one write path behind manual entry and
 * URL import (WP-14, §7.5).
 *
 * The shape of it is deliberately the scrape's shape. The professor's event
 * becomes a `source_records` row under the `manual` or `url-import` source, and
 * WP-10's linker turns it into an event — which means it is matched against what
 * is already there, so pasting a link to an event the app already knows joins
 * that event instead of making a second copy, and a later scrape of the same
 * page updates it normally.
 *
 * On top of that, every value the professor supplied or corrected is written as
 * an `event_overrides` row. That is what makes their answer survive: the
 * resolver puts an active override above every claim, whatever a source says
 * next week and whatever its trust rank is (§7.5).
 */

export interface ImportWriteDeps {
  readonly records: SourceRecordsRepository;
  readonly linker: EventLinker;
  readonly provenance: ProvenanceRepository;
  readonly resolver: EventResolver;
  readonly geocoder: Pick<Geocoder, 'resolve'>;
  readonly audit: AuditLog;
}

export interface ImportWriteInput {
  readonly source: SourceRow;
  readonly candidate: EventCandidate;
  /**
   * The professor's own values, normalized the same way. The record keeps the
   * source's candidate; the overrides are taken from this one, so "what the
   * page said" and "what the professor says" stay two separate statements.
   */
  readonly overrideCandidate?: EventCandidate | undefined;
  /** The bytes to snapshot, when a page was read (§7.8). */
  readonly rawSnapshotRef?: string | undefined;
  /** Fields the professor stated themselves; each becomes an override. */
  readonly overrideFields: readonly OverrideField[];
  /** `manual entry` or `URL import review` — shown next to the value (WP-16b). */
  readonly overrideReason: string;
  readonly actorId: string;
  readonly actorName: string;
  /** `event.created.manual` or `event.imported.url` (R35). */
  readonly action: string;
  readonly requestId?: string | undefined;
  readonly at: number;
}

/**
 * Which of the fields the professor supplied actually carry a value.
 *
 * An override whose value is null would state "this field is empty" and beat
 * every source that knows better — which is the opposite of what leaving a box
 * blank means. So a blank box writes no override at all, and the field stays
 * open to whatever a source says about it.
 */
export function statedOverrides(
  values: Readonly<Record<string, string | null>>,
  wanted: readonly OverrideField[],
): { field: OverrideField; valueJson: string }[] {
  return wanted.flatMap((field) => {
    const valueJson = values[field];
    return valueJson === null || valueJson === undefined ? [] : [{ field, valueJson }];
  });
}

/** Writes the record, links it to an event, and pins the professor's values. */
export function writeImportedEvent(
  deps: ImportWriteDeps,
  input: ImportWriteInput,
): EventImportResult {
  const { candidate, source, at } = input;
  const stated = input.overrideCandidate ?? candidate;
  const values = claimValues(stated, deps.geocoder.resolve(stated.place));
  const overrides = statedOverrides(values, input.overrideFields);

  return withAudit(
    deps.audit,
    (result: EventImportResult) => ({
      actorKind: 'USER' as const,
      actorUserId: input.actorId,
      action: input.action,
      entityKind: 'event',
      entityId: result.eventId,
      summary: `${candidate.title} (${source.key}) by ${input.actorName}`,
      diff: {
        sourceKey: source.key,
        externalKey: candidate.externalKey,
        url: candidate.url,
        created: result.created,
        overriddenFields: result.overriddenFields,
      },
      requestId: input.requestId ?? null,
    }),
    (): EventImportResult => {
      const upserted = deps.records.upsert({
        sourceId: source.id,
        externalKey: candidate.externalKey,
        url: candidate.url,
        contentHash: payloadHash(candidate),
        payloadJson: JSON.stringify(candidate),
        parseWarnings: candidate.warnings,
        ...(input.rawSnapshotRef === undefined ? {} : { rawSnapshotRef: input.rawSnapshotRef }),
        detailPending: false,
        at,
      });
      const linked = deps.linker.link({
        record: upserted.record,
        candidate,
        source,
        at,
      });
      for (const override of overrides) {
        deps.provenance.setOverride({
          eventId: linked.eventId,
          field: override.field,
          valueJson: override.valueJson,
          reason: input.overrideReason,
          setBy: input.actorId,
          at,
        });
      }
      if (overrides.length > 0) {
        // The overrides have to be resolved in after the link, or the event's
        // columns would show the source's values until the next scrape.
        deps.resolver.apply(linked.eventId, {
          cause: 'OVERRIDE',
          at,
          changedBy: input.actorId,
        });
      }
      const warnings: readonly ParseWarning[] = candidate.warnings;
      return {
        eventId: linked.eventId,
        created: linked.outcome === 'CREATED',
        sourceKey: source.key,
        overriddenFields: overrides.map((override) => override.field),
        warnings: [...warnings],
      };
    },
  );
}
