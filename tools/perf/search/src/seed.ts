import { schema, type DatabaseHandle } from '@compintel/backend';

import { CORPUS_EPOCH, type CorpusEvent } from './corpus.js';

/**
 * Loads a generated corpus into a migrated database, as rows — shared by
 * `pnpm perf:search` (20 000 events) and `pnpm seed:demo` (a few hundred, for
 * the WP-16a E2E). Ids are derived from the row index, so the database is as
 * reproducible as the corpus.
 */

/** A UUIDv7-shaped id derived from the row index, so the database is reproducible too. */
export const idOf = (prefix: number, index: number): string =>
  `0192${prefix.toString(16).padStart(4, '0')}-0000-7000-8000-${index.toString(16).padStart(12, '0')}`;

export function seed(
  db: DatabaseHandle,
  corpus: readonly CorpusEvent[],
  campus: { readonly lat: number; readonly lon: number } | undefined,
): string[] {
  if (campus !== undefined) seedCampus(db, campus);
  const sources = new Map(
    db.drizzle
      .select({ id: schema.sources.id, key: schema.sources.key })
      .from(schema.sources)
      .all()
      .map((row) => [row.key, row.id]),
  );
  const visible: string[] = [];
  db.raw.transaction(() => {
    for (let at = 0; at < corpus.length; at += 250) {
      const batch = corpus.slice(at, at + 250);
      db.drizzle
        .insert(schema.events)
        .values(
          batch.map((event) => ({
            id: idOf(2, event.index),
            title: event.title,
            normalizedTitle: event.title.toLowerCase(),
            eventType: event.eventType as never,
            isRecurringRound: event.isRecurringRound,
            organizerName: event.organizerName,
            organizerKind: event.organizerKind as never,
            descriptionMd: event.descriptionMd,
            mode: event.mode,
            city: event.city,
            countryCode: event.city === null ? null : 'IN',
            lat: event.lat,
            lon: event.lon,
            geoPrecision: event.geoPrecision,
            registrationDeadlineAt: event.registrationDeadlineAt,
            registrationDeadlinePrecision:
              event.registrationDeadlineAt === null ? 'UNKNOWN' : 'DATE',
            startsAt: event.startsAt,
            endsAt: event.endsAt,
            datePrecision: event.startsAt === null ? 'UNKNOWN' : 'DATE',
            teamMin: event.teamMin,
            teamMax: event.teamMax,
            feeKnown: event.feeKnown,
            feeMinor: event.feeMinor,
            feeCurrency: event.feeKnown ? 'INR' : null,
            prizeTotalMinor: event.prizeTotalMinor,
            prizeCurrency: event.prizeTotalMinor === null ? null : 'INR',
            visibility: event.visibility,
            policyReason: event.visibility === 'POLICY_HIDDEN' ? 'EVENT_TYPE_NOT_ALLOWED' : null,
            qualityScore: 60,
            firstSeenAt: event.firstSeenAt,
            lastChangedAt: event.firstSeenAt,
            createdAt: event.firstSeenAt,
            updatedAt: event.firstSeenAt,
          })) as (typeof schema.events.$inferInsert)[],
        )
        .run();
      db.drizzle
        .insert(schema.sourceRecords)
        .values(
          batch.map((event) => ({
            id: idOf(3, event.index),
            sourceId: sources.get(event.sourceKey) ?? '',
            externalKey: `perf-${String(event.index)}`,
            url: `https://${event.sourceKey}.example.test/${String(event.index)}`,
            firstSeenAt: event.firstSeenAt,
            lastSeenAt: CORPUS_EPOCH,
            lastFetchedAt: CORPUS_EPOCH,
            contentHash: String(event.index),
            payloadJson: '{}',
            eventId: idOf(2, event.index),
            originEventId: idOf(2, event.index),
          })),
        )
        .run();
      for (const event of batch) {
        if (event.visibility === 'VISIBLE') visible.push(idOf(2, event.index));
      }
    }
  })();
  return visible;
}

/** The organization and its primary campus, which distances are measured from. */
export function seedCampus(
  db: DatabaseHandle,
  campus: { readonly lat: number; readonly lon: number },
): void {
  const organizationId = idOf(1, 1);
  db.drizzle
    .insert(schema.organizations)
    .values({
      id: organizationId,
      name: 'Perf Institute',
      createdAt: CORPUS_EPOCH,
      updatedAt: CORPUS_EPOCH,
    })
    .run();
  db.drizzle
    .insert(schema.campuses)
    .values({
      id: idOf(1, 2),
      organizationId,
      name: 'Main',
      ...campus,
      isPrimary: true,
      createdAt: CORPUS_EPOCH,
      updatedAt: CORPUS_EPOCH,
    })
    .run();
}
