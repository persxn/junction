import { z } from 'zod';

import { CategoryOrigin } from './categories.js';
import { ConflictValue, EventChangePage } from './dedup.js';
import { Instant, OverrideField, OVERRIDE_FIELDS, type ChangeCause } from './events.js';
import { Uuid7 } from './ids.js';
import { EventCore } from './search.js';

/**
 * The event detail drawer's payload (§16.2, WP-16b).
 *
 * One request, one shape. §16.2's drawer shows the facts, where each of them
 * came from, what the sources that disagree each said, the deadlines, the
 * sources with their attribution (D-32) and the change history — and a drawer
 * that fanned out into six requests would show them arriving one after another,
 * which is exactly the "is this still loading or is it just empty?" a professor
 * should never have to ask.
 *
 * Nothing here is averaged, merged or smoothed (§7.5). A claim's `value` is the
 * JSON one source stated, unchanged; the selected one is marked and says why it
 * won, and the reason is one of four named outcomes rather than a sentence the
 * backend made up.
 */

/**
 * Why the selected value won (§7.5: active override > highest `trust_rank` >
 * most recent observation).
 *
 * `ONLY_SOURCE` is the fourth: with one claim there is no contest, and saying
 * "it had the highest trust rank" of an uncontested value would be technically
 * true and practically misleading.
 */
export const SELECTION_REASONS = [
  'OVERRIDE',
  'ONLY_SOURCE',
  'HIGHEST_TRUST',
  'MOST_RECENT',
] as const;
export const SelectionReason = z.enum(SELECTION_REASONS);
export type SelectionReason = z.infer<typeof SelectionReason>;

/** One source's statement of one field, as the provenance tooltip reads it. */
export const FieldClaim = z
  .object({
    id: Uuid7,
    /** The value as JSON-decoded; `null` is the source saying the field is empty. */
    value: z.json(),
    sourceKey: z.string().min(1),
    sourceName: z.string().min(1),
    trustRank: z.int(),
    observedAt: Instant,
    isSelected: z.boolean(),
    /** R63: a second statement by the same source that lost to its structured field. */
    isAlternate: z.boolean(),
    note: z.string().nullable(),
  })
  .strict();
export type FieldClaim = z.infer<typeof FieldClaim>;

/**
 * Every claim on one field, best first. `selectedReason` is why the value on
 * the event row is the one it is, and `selectedSourceName` who said it — the
 * two halves of "as stated by Devfolio, verified 2 h ago".
 */
export const ClaimGroup = z
  .object({
    field: OverrideField,
    /** The §16.2 facts grid's label for the field ("Registration deadline"). */
    label: z.string().min(1),
    claims: z.array(FieldClaim).min(1),
    selectedReason: SelectionReason,
    selectedSourceName: z.string().min(1).nullable(),
    /** When the selected claim was last seen at its source. */
    verifiedAt: Instant.nullable(),
  })
  .strict();
export type ClaimGroup = z.infer<typeof ClaimGroup>;

/**
 * One field the sources disagree about, with every claimed value and the reason
 * the selected one won — the "Sources disagree" panel, which is §19's
 * acceptance criterion for this WP.
 */
export const DetailConflict = z
  .object({
    field: OverrideField,
    label: z.string().min(1),
    /** True when §7.5 calls the disagreement material (dates > 1 h, team size, fee, mode, R63). */
    material: z.boolean(),
    values: z.array(ConflictValue).min(2),
    selected: z.json(),
    selectedReason: SelectionReason,
    selectedSourceName: z.string().min(1).nullable(),
    /**
     * Which claim won, by its source record — not by its value.
     *
     * Two sources can state the same thing and still lose to a third: on the
     * WP-16b fixture the site and Devfolio both say the smallest team is 2
     * while CTFtime says 3, and marking "the selected value" by comparing
     * values would tick both of them. Exactly one claim was selected, so the
     * panel marks exactly one. `null` when an override won, where no claim did.
     */
    selectedSourceRecordId: z.string().nullable(),
  })
  .strict();
export type DetailConflict = z.infer<typeof DetailConflict>;

/** A source that lists the event, with the attribution D-32 puts on every one. */
export const EventSourceDetail = z
  .object({
    key: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
    firstSeenAt: Instant,
    lastSeenAt: Instant,
    lastFetchedAt: Instant,
    /** D-32: shown beside the source, never omitted when the source has one. */
    attributionText: z.string().nullable(),
    trustRank: z.int(),
  })
  .strict();
export type EventSourceDetail = z.infer<typeof EventSourceDetail>;

/** A category on the event, with where it came from (D-15's origin chips). */
export const EventCategoryDetail = z
  .object({
    id: Uuid7,
    name: z.string().min(1),
    slug: z.string().min(1),
    origin: CategoryOrigin,
    isSuppressed: z.boolean(),
  })
  .strict();
export type EventCategoryDetail = z.infer<typeof EventCategoryDetail>;

/**
 * `GET /events/:id/detail`. The core event (minus the two summary lists, which
 * are replaced by their detailed forms) plus provenance, conflicts, sources,
 * categories and the first page of the change history.
 */
export const EventDetailView = EventCore.omit({ categories: true, sources: true })
  .extend({
    claims: z.array(ClaimGroup),
    hasConflicts: z.boolean(),
    conflicts: z.array(DetailConflict),
    sources: z.array(EventSourceDetail),
    categories: z.array(EventCategoryDetail),
    history: EventChangePage,
  })
  .strict();
export type EventDetailView = z.infer<typeof EventDetailView>;

/**
 * `PUT /events/:id/categories` (§10.2 "Override an event's categories — ✓
 * audited", D-15).
 *
 * The body is the whole intended set, not a delta: a professor looking at the
 * chips is looking at a set, and sending the set removes the ambiguity of two
 * people each sending "add this one". Categories in `categoryIds` become MANUAL
 * rows (a suppression is cleared); every other category the event carries is
 * suppressed. `version` is §6.1's optimistic concurrency — a stale one is a 409.
 */
export const EventCategoriesInput = z
  .object({
    categoryIds: z.array(Uuid7).max(50),
    version: z.int().min(1),
  })
  .strict();
export type EventCategoriesInput = z.infer<typeof EventCategoriesInput>;

export const EventCategoriesResult = z
  .object({
    categories: z.array(EventCategoryDetail),
    version: z.int().min(1),
  })
  .strict();
export type EventCategoriesResult = z.infer<typeof EventCategoriesResult>;

// ---- Words for the things above ------------------------------------------------

/**
 * The facts grid's label for each overridable field (§16.2).
 *
 * It is a total record over `OVERRIDE_FIELDS`, so a field added to the event
 * vocabulary without a label is a type error rather than a camelCase column
 * name leaking onto a professor's screen.
 */
export const OVERRIDE_FIELD_LABELS: Readonly<Record<OverrideField, string>> = {
  title: 'Title',
  eventType: 'Event type',
  organizerName: 'Organizer',
  organizerKind: 'Organizer kind',
  hostInstitutionId: 'Host institution',
  summary: 'Summary',
  descriptionMd: 'Description',
  prizeText: 'Prize',
  prizeTotalMinor: 'Prize total',
  prizeCurrency: 'Prize currency',
  eligibilityText: 'Eligibility',
  requirementsText: 'Requirements',
  submissionRequirementsText: 'Submission requirements',
  mode: 'Mode',
  venueName: 'Venue',
  city: 'City',
  state: 'State',
  countryCode: 'Country',
  lat: 'Latitude',
  lon: 'Longitude',
  geoPrecision: 'Location precision',
  timezone: 'Time zone',
  registrationOpensAt: 'Registration opens',
  registrationDeadlineAt: 'Registration deadline',
  startsAt: 'Starts',
  endsAt: 'Ends',
  submissionDeadlineAt: 'Submission deadline',
  teamMin: 'Smallest team',
  teamMax: 'Largest team',
  feeKnown: 'Fee stated',
  feeMinor: 'Fee',
  feeCurrency: 'Fee currency',
  feeText: 'Fee (as stated)',
  officialUrl: 'Official website',
  registrationUrl: 'Registration link',
  editionYear: 'Edition',
  isRecurringRound: 'Recurring round',
  seriesId: 'Series',
  cancellation: 'Cancellation',
  visibility: 'Visibility',
};

export function overrideFieldLabel(field: OverrideField): string {
  return OVERRIDE_FIELD_LABELS[field];
}

/** Every field, in the order the facts grid lays them out. */
export const OVERRIDE_FIELD_ORDER: readonly OverrideField[] = OVERRIDE_FIELDS;

/** §6.2 `event_changes.cause`, as words rather than an enum value. */
export const CHANGE_CAUSE_LABELS: Readonly<Record<ChangeCause, string>> = {
  SCRAPE: 'Found by a scrape',
  OVERRIDE: 'Corrected by hand',
  MERGE: 'Merged with a duplicate',
  UNMERGE: 'Split from a duplicate',
  MANUAL: 'Entered by hand',
};

export function changeCauseLabel(cause: ChangeCause): string {
  return CHANGE_CAUSE_LABELS[cause];
}

/**
 * Why the selected value won, as one line. The source name is part of the
 * sentence because "it was the most recent" without a name is not an answer.
 */
export function selectionReasonText(reason: SelectionReason, sourceName: string | null): string {
  const named = sourceName ?? 'a source';
  switch (reason) {
    case 'OVERRIDE':
      return 'Selected because someone corrected this field by hand';
    case 'ONLY_SOURCE':
      return `Selected because only ${named} states it`;
    case 'HIGHEST_TRUST':
      return `Selected because ${named} is the most trusted source stating it`;
    case 'MOST_RECENT':
      return `Selected because ${named} stated it most recently`;
  }
}
