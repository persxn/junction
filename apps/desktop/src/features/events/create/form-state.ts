import type {
  EventMode,
  EventType,
  ImportField,
  ManualEventInput,
  OverrideField,
  UrlImportResult,
} from '@compintel/contracts';

import { DISPLAY_ZONE } from '../../discover/format.js';

/**
 * The event form, as data (WP-14 step 8).
 *
 * Kept out of the component so the two things that actually decide what a
 * professor can save — when Save is allowed, and what the request body looks
 * like — are testable without rendering anything, and so the import review and
 * the blank form cannot drift apart: both are this one state, filled in from
 * different places.
 *
 * Every field is a string, exactly as an `<input>` gives it. Converting to the
 * contract's shapes happens once, in {@link toManualInput}, so an empty box is
 * an absent field rather than an empty string written into the database.
 */

export interface EventFormState {
  title: string;
  eventType: string;
  organizerName: string;
  description: string;
  mode: string;
  venueName: string;
  city: string;
  state: string;
  countryCode: string;
  startsAt: string;
  endsAt: string;
  registrationDeadlineAt: string;
  teamSizeText: string;
  feeText: string;
  prizeText: string;
  officialUrl: string;
  registrationUrl: string;
}

export type EventFormField = keyof EventFormState;

export const EMPTY_FORM: EventFormState = {
  title: '',
  eventType: '',
  organizerName: '',
  description: '',
  mode: '',
  venueName: '',
  city: '',
  state: '',
  countryCode: '',
  startsAt: '',
  endsAt: '',
  registrationDeadlineAt: '',
  teamSizeText: '',
  feeText: '',
  prizeText: '',
  officialUrl: '',
  registrationUrl: '',
};

/** Which `event_overrides` field each box stands behind, for the commit. */
const OVERRIDE_OF: Partial<Record<EventFormField, readonly OverrideField[]>> = {
  title: ['title'],
  eventType: ['eventType'],
  organizerName: ['organizerName'],
  description: ['descriptionMd', 'summary'],
  mode: ['mode'],
  venueName: ['venueName'],
  city: ['city'],
  state: ['state'],
  countryCode: ['countryCode'],
  startsAt: ['startsAt'],
  endsAt: ['endsAt'],
  registrationDeadlineAt: ['registrationDeadlineAt'],
  teamSizeText: ['teamMin', 'teamMax'],
  feeText: ['feeKnown', 'feeMinor', 'feeCurrency', 'feeText'],
  prizeText: ['prizeText', 'prizeTotalMinor', 'prizeCurrency'],
  officialUrl: ['officialUrl'],
  registrationUrl: ['registrationUrl'],
};

function trimmed(value: string): string | undefined {
  const text = value.trim();
  return text.length === 0 ? undefined : text;
}

/**
 * Why Save is disabled, or `undefined` when it is not.
 *
 * A title and something to find the event by again: §7.5 matches on dates and
 * URLs, so an event with neither can never be recognised as the same event
 * twice — which makes it a note, not a record.
 */
export function whySaveDisabled(form: EventFormState): string | undefined {
  if (trimmed(form.title) === undefined) {
    return 'An event needs a title.';
  }
  const hasDate =
    trimmed(form.startsAt) !== undefined || trimmed(form.registrationDeadlineAt) !== undefined;
  const hasLink =
    trimmed(form.officialUrl) !== undefined || trimmed(form.registrationUrl) !== undefined;
  if (!hasDate && !hasLink) {
    return 'Add a date or a link, so the event can be found again.';
  }
  return undefined;
}

export function canSave(form: EventFormState): boolean {
  return whySaveDisabled(form) === undefined;
}

/** The message shown under one box, or `undefined`. */
export function fieldError(form: EventFormState, field: EventFormField): string | undefined {
  const value = trimmed(form[field]);
  if (field === 'title' && value === undefined) {
    return 'A title is required.';
  }
  if ((field === 'officialUrl' || field === 'registrationUrl') && value !== undefined) {
    return /^https?:\/\/\S+$/.test(value) ? undefined : 'That does not look like a link.';
  }
  if (field === 'countryCode' && value !== undefined && !/^[A-Za-z]{2}$/.test(value)) {
    return 'Two letters, e.g. IN.';
  }
  return undefined;
}

export function hasErrors(form: EventFormState): boolean {
  return (Object.keys(form) as EventFormField[]).some(
    (field) => fieldError(form, field) !== undefined,
  );
}

/** The request body. Empty boxes become absent fields, never empty values. */
export function toManualInput(form: EventFormState): ManualEventInput {
  const place = {
    ...(trimmed(form.venueName) === undefined ? {} : { venueName: trimmed(form.venueName) }),
    ...(trimmed(form.city) === undefined ? {} : { city: trimmed(form.city) }),
    ...(trimmed(form.state) === undefined ? {} : { state: trimmed(form.state) }),
    ...(trimmed(form.countryCode) === undefined
      ? {}
      : { countryCode: form.countryCode.trim().toUpperCase() }),
  };
  const date = (value: string): { at: string } | undefined => {
    const text = trimmed(value);
    return text === undefined ? undefined : { at: text };
  };
  return {
    title: form.title.trim(),
    ...(trimmed(form.eventType) === undefined ? {} : { eventType: form.eventType as EventType }),
    ...(trimmed(form.organizerName) === undefined
      ? {}
      : { organizerName: trimmed(form.organizerName) }),
    ...(trimmed(form.description) === undefined ? {} : { description: trimmed(form.description) }),
    ...(trimmed(form.mode) === undefined ? {} : { mode: form.mode as EventMode }),
    ...(Object.keys(place).length === 0 ? {} : { place }),
    ...(date(form.startsAt) === undefined ? {} : { startsAt: date(form.startsAt) }),
    ...(date(form.endsAt) === undefined ? {} : { endsAt: date(form.endsAt) }),
    ...(date(form.registrationDeadlineAt) === undefined
      ? {}
      : { registrationDeadlineAt: date(form.registrationDeadlineAt) }),
    ...(trimmed(form.teamSizeText) === undefined
      ? {}
      : { teamSizeText: trimmed(form.teamSizeText) }),
    ...(trimmed(form.feeText) === undefined ? {} : { feeText: trimmed(form.feeText) }),
    ...(trimmed(form.prizeText) === undefined ? {} : { prizeText: trimmed(form.prizeText) }),
    ...(trimmed(form.officialUrl) === undefined ? {} : { officialUrl: trimmed(form.officialUrl) }),
    ...(trimmed(form.registrationUrl) === undefined
      ? {}
      : { registrationUrl: trimmed(form.registrationUrl) }),
  };
}

/** The `edited` list a commit carries: the fields the professor changed. */
export function editedOverrides(edited: ReadonlySet<EventFormField>): OverrideField[] {
  return [...edited].flatMap((field) => [...(OVERRIDE_OF[field] ?? [])]);
}

/** The form box one imported field fills, when it fills one. */
const FIELD_OF_IMPORT: Readonly<Record<string, EventFormField>> = {
  title: 'title',
  description: 'description',
  organizerName: 'organizerName',
  startsAt: 'startsAt',
  endsAt: 'endsAt',
  registrationDeadlineAt: 'registrationDeadlineAt',
  mode: 'mode',
  feeText: 'feeText',
  prizeText: 'prizeText',
  teamSizeText: 'teamSizeText',
  officialUrl: 'officialUrl',
  registrationUrl: 'registrationUrl',
};

/** An `<input type="datetime-local">` value, or the text as it came. */
function forInput(field: EventFormField, value: string): string {
  if (field !== 'startsAt' && field !== 'endsAt' && field !== 'registrationDeadlineAt') {
    return value;
  }
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    // Prose the professor will have to read and correct — which is the point of
    // showing what was found rather than only what could be parsed.
    return value;
  }
  // The boxes are wall-clock time in the display zone, which is how the backend
  // reads them back; a UTC slice here showed 09:00 IST as 03:30 (pre-M2b).
  const local = LOCAL_MINUTE.formatToParts(new Date(parsed));
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    local.find((entry) => entry.type === type)?.value ?? '';
  const day = `${part('year')}-${part('month')}-${part('day')}`;
  return field === 'registrationDeadlineAt' ? day : `${day}T${part('hour')}:${part('minute')}`;
}

const LOCAL_MINUTE = new Intl.DateTimeFormat('en-CA', {
  timeZone: DISPLAY_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

/**
 * The form as a preview fills it, plus which boxes carry a low-confidence
 * guess the professor should look at twice.
 */
export function fromPreview(result: UrlImportResult): {
  form: EventFormState;
  uncertain: Set<EventFormField>;
  origins: Map<EventFormField, ImportField>;
} {
  const form: EventFormState = { ...EMPTY_FORM };
  const uncertain = new Set<EventFormField>();
  const origins = new Map<EventFormField, ImportField>();
  for (const found of result.fieldsFound) {
    const field = FIELD_OF_IMPORT[found.field];
    if (field === undefined) {
      continue;
    }
    form[field] = forInput(field, found.value);
    origins.set(field, found);
    if (found.confidence < 0.8) {
      uncertain.add(field);
    }
  }
  const candidate = result.candidate;
  if (candidate?.eventType !== undefined) {
    form.eventType = candidate.eventType.value;
  }
  if (candidate?.place !== undefined) {
    form.venueName = candidate.place.venueName ?? '';
    form.city = candidate.place.city ?? '';
    form.state = candidate.place.state ?? '';
    form.countryCode = candidate.place.countryCode ?? '';
  }
  // The link is always kept, whichever path the import took — a MANUAL_ONLY
  // answer has nothing else, and the link is the whole point of it (D-30).
  if (form.officialUrl === '') {
    form.officialUrl = result.url;
  }
  return { form, uncertain, origins };
}
