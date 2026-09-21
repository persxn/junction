import { EVENT_MODES, EVENT_TYPES, type ImportField } from '@compintel/contracts';
import { useId } from 'react';

import { fieldError, type EventFormField, type EventFormState } from './form-state.js';

/**
 * The event form's boxes (§16.3, WP-14 step 8).
 *
 * Every box has a label, an error line and a keyboard path, and the ones an
 * import filled in carry a chip saying where the value came from and how sure
 * the reader was. A low-confidence value is marked on the box itself rather
 * than in a summary somewhere else, because the box is where the professor is
 * looking when they decide whether to keep it.
 */

export interface EventFieldsProps {
  readonly form: EventFormState;
  readonly onChange: (field: EventFormField, value: string) => void;
  /** Where an imported value came from, per box. */
  readonly origins?: ReadonlyMap<EventFormField, ImportField>;
  /** Boxes whose imported value is a guess worth a second look. */
  readonly uncertain?: ReadonlySet<EventFormField>;
  readonly disabled?: boolean;
}

interface BoxProps extends EventFieldsProps {
  readonly field: EventFormField;
  readonly label: string;
  readonly type?: 'text' | 'date' | 'datetime-local' | 'url';
  readonly hint?: string;
  readonly multiline?: boolean;
  readonly options?: readonly string[];
  readonly autoFocus?: boolean;
}

const INPUT_CLASS =
  'w-full rounded-md border bg-surface px-3 py-2 text-fg transition-colors ' +
  'duration-[var(--ci-motion-fast)] placeholder:text-fg-subtle';

function ProvenanceChip({
  found,
  uncertain,
}: {
  readonly found: ImportField;
  readonly uncertain: boolean;
}): React.JSX.Element {
  const origin =
    found.origin === 'JSON_LD'
      ? 'from the page’s own event data'
      : found.origin === 'OPEN_GRAPH' || found.origin === 'TWITTER_CARD'
        ? 'from the page’s summary tags'
        : found.origin === 'ADAPTER'
          ? 'as the source states it'
          : 'read off the page';
  return (
    <span
      className={
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-sm ' +
        (uncertain ? 'bg-warning-subtle text-warning-strong' : 'bg-surface-sunken text-fg-muted')
      }
    >
      {uncertain ? 'Check this — ' : 'Found '}
      {origin}
    </span>
  );
}

function Box(props: BoxProps): React.JSX.Element {
  const id = useId();
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const { field, form, onChange, origins, uncertain, disabled } = props;
  const error = fieldError(form, field);
  const found = origins?.get(field);
  const isUncertain = uncertain?.has(field) === true;
  const describedBy = [
    props.hint === undefined ? undefined : hintId,
    error === undefined ? undefined : errorId,
  ]
    .filter((value): value is string => value !== undefined)
    .join(' ');
  const shared = {
    id,
    value: form[field],
    disabled,
    'aria-invalid': error === undefined ? undefined : (true as const),
    'aria-describedby': describedBy === '' ? undefined : describedBy,
    className: `${INPUT_CLASS} ${error === undefined ? 'border-line focus:border-accent' : 'border-danger'}`,
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="font-medium">
          {props.label}
        </label>
        {found !== undefined && <ProvenanceChip found={found} uncertain={isUncertain} />}
      </div>
      {props.multiline === true ? (
        <textarea
          {...shared}
          rows={5}
          onChange={(event) => {
            onChange(field, event.target.value);
          }}
        />
      ) : props.options !== undefined ? (
        <select
          {...shared}
          onChange={(event) => {
            onChange(field, event.target.value);
          }}
        >
          <option value="">Not stated</option>
          {props.options.map((option) => (
            <option key={option} value={option}>
              {option.replace(/_/g, ' ').toLowerCase()}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...shared}
          type={props.type ?? 'text'}
          autoFocus={props.autoFocus === true}
          onChange={(event) => {
            onChange(field, event.target.value);
          }}
        />
      )}
      {props.hint !== undefined && (
        <p id={hintId} className="text-sm text-fg-subtle">
          {props.hint}
        </p>
      )}
      {error !== undefined && (
        <p id={errorId} className="text-sm text-danger">
          {error}
        </p>
      )}
      {found?.raw !== undefined && found.raw !== form[field] && (
        <p className="text-sm text-fg-subtle">On the page: “{found.raw}”</p>
      )}
    </div>
  );
}

export function EventFields(props: EventFieldsProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-5">
      <Box {...props} field="title" label="Title" autoFocus />
      <div className="grid gap-5 sm:grid-cols-2">
        <Box {...props} field="eventType" label="Type" options={EVENT_TYPES} />
        <Box {...props} field="mode" label="Mode" options={EVENT_MODES} />
      </div>
      <Box {...props} field="organizerName" label="Organizer" />
      <Box
        {...props}
        field="description"
        label="Description"
        multiline
        hint="Contact details are removed when the event is saved."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Box {...props} field="startsAt" label="Starts" type="datetime-local" />
        <Box {...props} field="endsAt" label="Ends" type="datetime-local" />
      </div>
      <Box
        {...props}
        field="registrationDeadlineAt"
        label="Registration closes"
        type="date"
        hint="A date with no time means the end of that day."
      />
      <div className="grid gap-5 sm:grid-cols-2">
        <Box {...props} field="venueName" label="Venue" />
        <Box {...props} field="city" label="City" />
        <Box {...props} field="state" label="State" />
        <Box {...props} field="countryCode" label="Country code" hint="Two letters, e.g. IN." />
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        <Box {...props} field="teamSizeText" label="Team size" hint="“1–4”, “teams of 2”." />
        <Box {...props} field="feeText" label="Entry fee" hint="“Free”, “₹500 per team”." />
      </div>
      <Box {...props} field="prizeText" label="Prize" />
      <div className="grid gap-5 sm:grid-cols-2">
        <Box {...props} field="officialUrl" label="Official link" type="url" />
        <Box {...props} field="registrationUrl" label="Registration link" type="url" />
      </div>
    </div>
  );
}
