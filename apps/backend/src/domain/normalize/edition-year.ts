import type { CandidateDate } from '@compintel/contracts';

import { formatDay } from '../../platform/time.js';
import type { WarningCollector } from './warnings.js';

/**
 * `edition_year` — which run of a recurring event this is (§7.3, ruling A11).
 *
 * It is what turns "HackX" into "HackX 2024, 2025, 2026" instead of three
 * unrelated rows, so getting it wrong does visible damage: a 2026 edition filed
 * as 2025 lands in last year's history and disappears from this year's feed.
 *
 * A11 fixes the precedence and this file does not deviate from it:
 * **start year > registration-deadline year > a 2020–2100 year in the title.**
 * The dates win over the title because titles lie — organizers reuse last year's
 * template, and "HackX 2025" running in January 2026 is a copy-paste, not a
 * time machine. When they disagree the start year wins *and a warning is
 * recorded*, because a professor looking at the row should know the source
 * contradicted itself.
 */

/** §6.1's plausible range for a stored year. */
export const MIN_EDITION_YEAR = 2020;
export const MAX_EDITION_YEAR = 2100;

/** A four-digit year in a title, e.g. "HackX 2026" or "Smart India Hackathon'25". */
const TITLE_YEAR = /\b(20[2-9]\d|21\d{2})\b/g;

export interface EditionYearInputs {
  readonly startsAt?: CandidateDate | undefined;
  readonly registrationDeadlineAt?: CandidateDate | undefined;
  readonly title?: string | undefined;
  /** The event's timezone; the year of an instant depends on it. */
  readonly timezone: string;
}

/** The last plausible four-digit year in a title, or `undefined`. */
export function yearInTitle(title: string): number | undefined {
  const matches = [...title.matchAll(TITLE_YEAR)]
    .map((match) => Number(match[1]))
    .filter((year) => year >= MIN_EDITION_YEAR && year <= MAX_EDITION_YEAR);
  // The last one, because "HackX 2026 — 5th edition since 2021" names the
  // edition first and the history afterwards far less often than the reverse.
  return matches.at(-1);
}

/** The calendar year an instant falls in, in the event's own timezone. */
function yearOf(date: CandidateDate, timezone: string): number {
  return Number(formatDay(timezone, new Date(date.at)).slice(0, 4));
}

/**
 * Resolves `edition_year` by A11's precedence, warning when the title disagrees
 * with the start date.
 */
export function resolveEditionYear(
  inputs: EditionYearInputs,
  warnings?: WarningCollector,
): number | undefined {
  const fromTitle = inputs.title === undefined ? undefined : yearInTitle(inputs.title);

  const fromStart =
    inputs.startsAt === undefined ? undefined : yearOf(inputs.startsAt, inputs.timezone);
  if (fromStart !== undefined && inRange(fromStart)) {
    if (fromTitle !== undefined && fromTitle !== fromStart) {
      warnings?.add(
        'EDITION_YEAR_CONFLICT',
        `The title says ${String(fromTitle)} but the event starts in ${String(fromStart)}; ` +
          'the start date wins (A11).',
        'editionYear',
      );
    }
    return fromStart;
  }

  const fromRegistration =
    inputs.registrationDeadlineAt === undefined
      ? undefined
      : yearOf(inputs.registrationDeadlineAt, inputs.timezone);
  if (fromRegistration !== undefined && inRange(fromRegistration)) {
    if (fromTitle !== undefined && fromTitle !== fromRegistration) {
      warnings?.add(
        'EDITION_YEAR_CONFLICT',
        `The title says ${String(fromTitle)} but registration closes in ${String(fromRegistration)}; ` +
          'the registration deadline wins (A11).',
        'editionYear',
      );
    }
    return fromRegistration;
  }

  return fromTitle;
}

function inRange(year: number): boolean {
  return year >= MIN_EDITION_YEAR && year <= MAX_EDITION_YEAR;
}
