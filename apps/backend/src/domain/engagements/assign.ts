import type { AssignWarning, Cancellation, ParticipantKind } from '@compintel/contracts';

/**
 * R98's review-step warnings, pure: registration closed or closing within
 * three days, the event cancelled or postponed, a roster outside the event's
 * team size. Warnings never block an assignment; an unknown bound warns nothing.
 */

const DAY_MS = 86_400_000;
export const CLOSING_WARNING_DAYS = 3;

export interface WarningInput {
  readonly registrationDeadlineAt: number | null;
  readonly cancellation: Cancellation;
  readonly teamMin: number | null;
  readonly teamMax: number | null;
  readonly kind: ParticipantKind;
  /** The roster sizes of the competitions about to be created. */
  readonly rosterSizes: readonly number[];
}

const plural = (count: number, word: string): string =>
  `${String(count)} ${word}${count === 1 ? '' : 's'}`;

export function assignWarnings(input: WarningInput, now: number): AssignWarning[] {
  const warnings: AssignWarning[] = [];
  const deadline = input.registrationDeadlineAt;
  if (deadline !== null && deadline < now) {
    warnings.push({
      code: 'REGISTRATION_CLOSED',
      message: 'Registration has already closed for this event.',
    });
  } else if (deadline !== null && deadline - now <= CLOSING_WARNING_DAYS * DAY_MS) {
    const days = Math.max(0, Math.ceil((deadline - now) / DAY_MS));
    warnings.push({
      code: 'REGISTRATION_CLOSING',
      message:
        days === 0
          ? 'Registration closes today.'
          : `Registration closes in ${plural(days, 'day')}.`,
    });
  }
  if (input.cancellation === 'CANCELLED') {
    warnings.push({ code: 'EVENT_CANCELLED', message: 'This event has been cancelled.' });
  } else if (input.cancellation === 'POSTPONED') {
    warnings.push({
      code: 'EVENT_POSTPONED',
      message: 'This event has been postponed; its dates may change.',
    });
  }
  const sizes = input.rosterSizes.filter((size) => size > 0);
  const smallest = Math.min(...sizes);
  const largest = Math.max(...sizes);
  if (sizes.length > 0 && input.teamMin !== null && smallest < input.teamMin) {
    warnings.push({
      code: 'TEAM_TOO_SMALL',
      message:
        input.kind === 'INDIVIDUAL'
          ? `This event wants teams of at least ${String(input.teamMin)}; an individual entry is one person.`
          : `This event wants at least ${plural(input.teamMin, 'member')}; the roster has ${String(smallest)}.`,
    });
  }
  if (sizes.length > 0 && input.teamMax !== null && largest > input.teamMax) {
    warnings.push({
      code: 'TEAM_TOO_LARGE',
      message: `This event allows at most ${plural(input.teamMax, 'member')}; the roster has ${String(largest)}.`,
    });
  }
  return warnings;
}
