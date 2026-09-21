import { z } from 'zod';

import { DeadlineKind, OverrideField } from './events.js';
import { DatePrecision, EventMode, EventType } from './enums.js';
import { CandidatePlace, EventCandidate, ParseWarning } from './event-candidate.js';

/**
 * Manual event entry and URL import (§7.1's URL-import bullet, D-30, WP-14).
 *
 * The two features share one shape on purpose. A professor typing an event in
 * and a professor correcting what we read off a page are doing the same thing —
 * stating a value themselves — and both end as `event_overrides` rows that a
 * later scrape may not overwrite (§7.5). So the import preview speaks
 * `EventCandidate`, the form speaks {@link ManualEventInput}, and the commit is
 * the same call either way.
 */

/**
 * What URL import does with a link, decided before any request is made (D-30).
 *
 * - `ADAPTER` — the domain belongs to an approved source, so that adapter's
 *   `detail()` and `normalize()` read it under the usual gate.
 * - `MANUAL_ONLY` — the domain belongs to a MANUAL_IMPORT_ONLY or BLOCKED
 *   source (Devpost). **No request of any kind is made, robots.txt included**;
 *   the form opens with the link attached.
 * - `GENERIC` — the domain is in no source's table, so one robots-checked page
 *   is read by the generic extractor.
 */
export const IMPORT_DISPOSITIONS = ['ADAPTER', 'MANUAL_ONLY', 'GENERIC'] as const;
export const ImportDisposition = z.enum(IMPORT_DISPOSITIONS);
export type ImportDisposition = z.infer<typeof ImportDisposition>;

/**
 * Where one extracted value came from, in the order the extractor tries them
 * (§4.8). It is shown next to the field in the review step, because "schema.org
 * said so" and "this was the first `<h1>` on the page" deserve different trust.
 */
export const IMPORT_FIELD_ORIGINS = [
  'JSON_LD',
  'OPEN_GRAPH',
  'TWITTER_CARD',
  'HEURISTIC',
  'ADAPTER',
  'TYPED',
] as const;
export const ImportFieldOrigin = z.enum(IMPORT_FIELD_ORIGINS);
export type ImportFieldOrigin = z.infer<typeof ImportFieldOrigin>;

/** One field the preview found, as the review step shows it. */
export const ImportField = z
  .object({
    /** The `EventCandidate` field this fills, e.g. `startsAt`. */
    field: z.string().min(1),
    /** Human label for the form row, e.g. "Starts". */
    label: z.string().min(1),
    /** The value as the professor will read it before editing. */
    value: z.string().min(1),
    confidence: z.number().min(0).max(1),
    origin: ImportFieldOrigin,
    /** The text on the page this was read from (§7.1 "the original text"). */
    raw: z.string().min(1).optional(),
  })
  .strict();
export type ImportField = z.infer<typeof ImportField>;

export const UrlImportRequest = z.object({ url: z.string().trim().min(1).max(2048) }).strict();
export type UrlImportRequest = z.infer<typeof UrlImportRequest>;

/**
 * What the preview answers. **It writes nothing** — every field here is for the
 * professor to look at, edit and then commit.
 *
 * `fieldsMissing` is as much of the answer as `fieldsFound`: §16.3 asks an empty
 * state to say what is not there, and a preview that lists four values while
 * silently omitting the deadline invites a professor to assume there is none.
 */
export const UrlImportResult = z
  .object({
    disposition: ImportDisposition,
    /** The URL after normalization — this is what gets saved and matched on. */
    url: z.url(),
    /** The source the domain belongs to, for `ADAPTER` and `MANUAL_ONLY`. */
    sourceKey: z.string().min(1).optional(),
    sourceName: z.string().min(1).optional(),
    /** What we read, when anything was read. */
    candidate: EventCandidate.optional(),
    /** Why this disposition, in the source's own words (its `compliance_notes`). */
    reason: z.string().min(1).optional(),
    fieldsFound: z.array(ImportField),
    /** Labels of the fields nothing was found for. */
    fieldsMissing: z.array(z.string().min(1)),
    warnings: z.array(ParseWarning),
  })
  .strict();
export type UrlImportResult = z.infer<typeof UrlImportResult>;

/** A date as the form states it: an ISO instant, or a plain `YYYY-MM-DD` day. */
export const ManualDate = z
  .object({
    /** ISO 8601. A date-only value means the whole day in `timezone` (§7.3). */
    at: z.string().trim().min(4).max(40),
    /** Absent means the form did not say; the normalizer decides from `at`. */
    precision: DatePrecision.optional(),
  })
  .strict();
export type ManualDate = z.infer<typeof ManualDate>;

export const ManualDeadline = z
  .object({
    kind: DeadlineKind,
    label: z.string().trim().min(1).max(200),
    at: z.string().trim().min(4).max(40),
    precision: DatePrecision.optional(),
  })
  .strict();
export type ManualDeadline = z.infer<typeof ManualDeadline>;

/**
 * An event as a professor states it (§10.2 "add manual events; URL import").
 *
 * Only the title is required. Everything else is optional and **absent means
 * unknown**, never a default: §6.1's rule applies to a person's entry exactly as
 * it does to a scrape, and a form that quietly writes "Online" because nothing
 * was picked is inventing a fact the professor never stated.
 *
 * The vocabulary is `EventCandidate`'s, so one mapper serves the form, the
 * import review and the goldens.
 */
export const ManualEventInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    eventType: EventType.optional(),
    organizerName: z.string().trim().min(1).max(300).optional(),

    summary: z.string().trim().max(500).optional(),
    /** Markdown or HTML; sanitized and redacted on the way in (§7.3, D-29). */
    description: z.string().max(200_000).optional(),
    eligibilityText: z.string().max(20_000).optional(),
    requirementsText: z.string().max(20_000).optional(),
    submissionRequirementsText: z.string().max(20_000).optional(),
    prizeText: z.string().max(20_000).optional(),

    mode: EventMode.optional(),
    place: CandidatePlace.optional(),
    /** IANA zone; the form offers the campus default. */
    timezone: z.string().trim().min(1).max(64).optional(),

    registrationOpensAt: ManualDate.optional(),
    registrationDeadlineAt: ManualDate.optional(),
    startsAt: ManualDate.optional(),
    endsAt: ManualDate.optional(),
    submissionDeadlineAt: ManualDate.optional(),
    resultAt: ManualDate.optional(),
    deadlines: z.array(ManualDeadline).max(20).optional(),

    /** "1-4", "up to 4" — parsed by WP-08a, never invented here. */
    teamSizeText: z.string().trim().max(200).optional(),
    feeText: z.string().trim().max(200).optional(),

    officialUrl: z.url().max(2048).optional(),
    registrationUrl: z.url().max(2048).optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.startsAt !== undefined ||
      input.registrationDeadlineAt !== undefined ||
      input.officialUrl !== undefined ||
      input.registrationUrl !== undefined,
    {
      message: 'An event needs a date or a link, so it can be found again.',
    },
  );
export type ManualEventInput = z.infer<typeof ManualEventInput>;

/**
 * Committing a reviewed import.
 *
 * The preview already read the page; the commit does **not** read it again. What
 * comes back is what the professor saw and corrected, so one import is one
 * request to somebody else's server, not two.
 *
 * `edited` names the fields the professor changed in the review step. Those get
 * `event_overrides` rows so a later scrape of the same event cannot overwrite
 * them (§7.5); the rest stay ordinary source claims that a scrape may update.
 */
export const UrlImportCommitRequest = z
  .object({
    url: z.url().max(2048),
    disposition: ImportDisposition,
    sourceKey: z.string().min(1).max(64).optional(),
    fields: ManualEventInput,
    edited: z.array(OverrideField).max(60).default([]),
  })
  .strict();
export type UrlImportCommitRequest = z.infer<typeof UrlImportCommitRequest>;

/** What both writes answer with. */
export const EventImportResult = z
  .object({
    eventId: z.string().min(1),
    /** False when the URL matched an existing event and joined it (§7.5). */
    created: z.boolean(),
    /** The source the new `source_records` row belongs to. */
    sourceKey: z.string().min(1),
    /** Fields written as overrides, i.e. protected from the next scrape. */
    overriddenFields: z.array(OverrideField),
    warnings: z.array(ParseWarning),
  })
  .strict();
export type EventImportResult = z.infer<typeof EventImportResult>;
