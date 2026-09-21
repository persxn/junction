import type { ClaimGroup, EventDetailView, OverrideField } from '@compintel/contracts';

import { formatDistance, formatPrize, formatTeam } from '../format.js';
import { EVENT_TYPE_LABELS, MODE_LABELS } from '../labels.js';
import { Provenance } from './Provenance.js';
import { formatDeadline } from './values.js';

export interface FactsGridProps {
  readonly event: EventDetailView;
  readonly now: number;
}

interface Fact {
  readonly field: OverrideField | undefined;
  readonly label: string;
  readonly value: string;
}

/**
 * The facts grid with provenance tooltips (§16.2).
 *
 * Every fact that has a claim behind it carries the source that stated it; a
 * fact that is computed here (the distance from campus) or that nobody claimed
 * carries nothing, because attaching "as stated by…" to a number the app worked
 * out itself would be a lie in the one place that must not have any.
 */
export function FactsGrid({ event, now }: FactsGridProps): React.JSX.Element {
  const claims = new Map<OverrideField, ClaimGroup>(
    event.claims.map((group) => [group.field, group]),
  );
  const prize = formatPrize({
    text: event.prizeText,
    totalMinor: event.prizeTotalMinor,
    currency: event.prizeCurrency,
  });
  const team = formatTeam(event.teamMin, event.teamMax);

  const facts: Fact[] = [
    { field: 'eventType', label: 'Type', value: EVENT_TYPE_LABELS[event.eventType] },
    {
      field: 'organizerName',
      label: 'Organizer',
      value: event.organizerName ?? 'Not stated',
    },
    { field: 'mode', label: 'Mode', value: MODE_LABELS[event.mode] },
    {
      field: undefined,
      label: 'Distance',
      value: formatDistance(event.distanceKm, event.mode),
    },
    {
      field: 'venueName',
      label: 'Venue',
      value: [event.venueName, event.city, event.state].filter(Boolean).join(', ') || 'Not stated',
    },
    {
      field: 'startsAt',
      label: 'Starts',
      value:
        event.startsAt === null
          ? 'Not announced'
          : formatDeadline(event.startsAt, event.datePrecision, now),
    },
    {
      field: 'registrationDeadlineAt',
      label: 'Registration deadline',
      value:
        event.registrationDeadlineAt === null
          ? 'Not announced'
          : formatDeadline(event.registrationDeadlineAt, event.registrationDeadlinePrecision, now),
    },
    { field: 'prizeText', label: 'Prize', value: prize ?? 'Not stated' },
    { field: 'teamMax', label: 'Team size', value: team ?? 'Not stated' },
    {
      field: 'feeText',
      label: 'Fee',
      value: event.feeKnown
        ? (event.feeText ??
          (event.feeMinor === null
            ? 'Not stated'
            : `${event.feeCurrency ?? ''} ${String(event.feeMinor / 100)}`.trim()))
        : 'Not stated',
    },
  ];

  return (
    <section aria-labelledby="drawer-facts">
      <h3 id="drawer-facts" className="mb-2 text-sm font-medium text-fg-muted">
        Facts
      </h3>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-2 text-sm">
        {facts.map((fact) => {
          const group = fact.field === undefined ? undefined : claims.get(fact.field);
          return (
            <div key={fact.label} className="contents">
              <dt className="text-fg-muted">{fact.label}</dt>
              <dd className="flex flex-col items-start gap-0.5">
                <span>{fact.value}</span>
                {group !== undefined && <Provenance group={group} now={now} />}
              </dd>
            </div>
          );
        })}
      </dl>
    </section>
  );
}
