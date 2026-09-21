import type { CandidatePlace, EventMode, ImportFieldOrigin } from '@compintel/contracts';

/**
 * What one page turned out to say, field by field, with where each value came
 * from (WP-14, §4.8's "schema.org `Event` JSON-LD/Open Graph as a generic
 * fallback for URL import").
 *
 * Every value keeps its origin and the text it was read from, because the review
 * step shows both: "schema.org said so" and "this was the first `<h1>` on the
 * page" are different claims, and a professor about to save an event is entitled
 * to know which one they are looking at.
 *
 * Nothing here is guessed. A field nothing was found for is **absent**, and the
 * preview lists it as not found rather than filling it with a plausible value.
 */

export interface Found<T> {
  readonly value: T;
  readonly origin: ImportFieldOrigin;
  /** The text on the page this was read from. */
  readonly raw?: string;
  /** 1 structured, ~0.8 a reliable pattern, ~0.5 a heuristic (R51's scale). */
  readonly confidence: number;
}

/** The fields a generic page read can fill. Dates stay as text or ISO strings. */
export interface FoundEvent {
  readonly title?: Found<string>;
  readonly description?: Found<string>;
  readonly organizerName?: Found<string>;
  readonly startsAt?: Found<string>;
  readonly endsAt?: Found<string>;
  readonly registrationDeadlineAt?: Found<string>;
  readonly mode?: Found<EventMode>;
  readonly place?: Found<CandidatePlace>;
  readonly feeText?: Found<string>;
  readonly prizeText?: Found<string>;
  readonly teamSizeText?: Found<string>;
  readonly officialUrl?: Found<string>;
  readonly registrationUrl?: Found<string>;
}

export const FOUND_FIELDS = [
  'title',
  'description',
  'organizerName',
  'startsAt',
  'endsAt',
  'registrationDeadlineAt',
  'mode',
  'place',
  'feeText',
  'prizeText',
  'teamSizeText',
  'officialUrl',
  'registrationUrl',
] as const satisfies readonly (keyof FoundEvent)[];
export type FoundField = (typeof FOUND_FIELDS)[number];

/** The label the review step puts on each field. */
export const FOUND_LABELS: Readonly<Record<FoundField, string>> = {
  title: 'Title',
  description: 'Description',
  organizerName: 'Organizer',
  startsAt: 'Starts',
  endsAt: 'Ends',
  registrationDeadlineAt: 'Registration closes',
  mode: 'Mode',
  place: 'Place',
  feeText: 'Entry fee',
  prizeText: 'Prize',
  teamSizeText: 'Team size',
  officialUrl: 'Official link',
  registrationUrl: 'Registration link',
};

/**
 * Later readers fill gaps; they never overwrite. That is the precedence §4.8
 * fixes — JSON-LD, then Open Graph, then heuristics — expressed once, so adding
 * a reader cannot quietly promote a guess over a structured value.
 */
export function fillGaps(base: FoundEvent, extra: FoundEvent): FoundEvent {
  const merged: FoundEvent = { ...base };
  const writable = merged as Record<string, unknown>;
  for (const field of FOUND_FIELDS) {
    if (writable[field] === undefined && extra[field] !== undefined) {
      writable[field] = extra[field];
    }
  }
  return merged;
}

/** Whether anything at all was found (nothing → `IMPORT_EXTRACTION_FAILED`). */
export function foundAnything(found: FoundEvent): boolean {
  return FOUND_FIELDS.some((field) => found[field] !== undefined);
}

/** Trims, collapses whitespace and gives up on empty strings. */
export function cleanText(raw: string | undefined, max = 20_000): string | undefined {
  if (raw === undefined) {
    return undefined;
  }
  const text = raw.replace(/\s+/g, ' ').trim();
  return text.length === 0 ? undefined : text.slice(0, max);
}
