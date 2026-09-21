import type { RankedEventListItem } from '@compintel/contracts';
import {
  AlertTriangle,
  Award,
  ChevronDown,
  EyeOff,
  Globe,
  MapPin,
  Star,
  UserPlus,
  Users,
} from 'lucide-react';
import { useId, useState } from 'react';

import { formatDistance, formatPrize, formatTeam } from './format.js';
import { EVENT_TYPE_LABELS, sourceName } from './labels.js';
import { countdown } from './urgency.js';

export interface EventCardProps {
  readonly item: RankedEventListItem;
  readonly now: number;
  readonly selected: boolean;
  readonly cardRef: (element: HTMLElement | null) => void;
  readonly onFocusCard: () => void;
  readonly onOpen: () => void;
  readonly onSave: () => void;
  readonly onHide: () => void;
}

/** "Assigning arrives with teams (M2)" — present, honest, and not faked (WP-16a step 7). */
export const ASSIGN_LATER = 'Assigning arrives with teams (M2)';

/**
 * One dense card (§16.2). Every status is an icon **and** words (§16.3): the
 * countdown's urgency, the conflict marker and each source have an accessible
 * name that does not depend on colour. The card itself is the roving tab stop
 * the list moves with J/K; Enter on it opens the event.
 */
export function EventCard({
  item,
  now,
  selected,
  cardRef,
  onFocusCard,
  onOpen,
  onSave,
  onHide,
}: EventCardProps): React.JSX.Element {
  const [whyOpen, setWhyOpen] = useState(false);
  const whyId = useId();
  const titleId = useId();
  const due = countdown(item.registrationDeadlineAt, item.registrationDeadlinePrecision, now);
  const DueIcon = due.icon;
  const prize = formatPrize(item.prize);
  const team = formatTeam(item.teamMin, item.teamMax);

  return (
    <article
      ref={cardRef}
      aria-labelledby={titleId}
      tabIndex={selected ? 0 : -1}
      data-selected={selected}
      onFocus={(event) => {
        if (event.target === event.currentTarget) onFocusCard();
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' && event.target === event.currentTarget) {
          event.preventDefault();
          onOpen();
        }
      }}
      className="rounded-lg border border-line bg-surface-raised p-3 outline-offset-2 data-[selected=true]:border-accent"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 id={titleId} className="text-md font-medium">
            <button
              type="button"
              tabIndex={-1}
              onClick={onOpen}
              className="text-left hover:underline"
            >
              {item.title}
            </button>
          </h3>
          <p className="text-sm text-fg-muted">
            {item.organizerName ?? 'Organizer not stated'} · {EVENT_TYPE_LABELS[item.eventType]}
          </p>
        </div>
        <p className={`flex shrink-0 items-center gap-1 text-sm font-medium ${due.tone}`}>
          <DueIcon aria-hidden="true" className="size-4" />
          <span className="sr-only">{due.levelLabel}: </span>
          {due.label}
        </p>
      </div>

      <ul className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-fg-muted">
        <li className="flex items-center gap-1">
          <MapPin aria-hidden="true" className="size-3.5" />
          {formatDistance(item.distanceKm, item.mode)}
        </li>
        {prize !== undefined && (
          <li className="flex items-center gap-1">
            <Award aria-hidden="true" className="size-3.5" />
            <span className="sr-only">Prize: </span>
            {prize}
          </li>
        )}
        {team !== undefined && (
          <li className="flex items-center gap-1">
            <Users aria-hidden="true" className="size-3.5" />
            {team}
          </li>
        )}
        <li className="flex items-center gap-1" aria-label="Sources">
          {item.sources.map((key) => (
            <span
              key={key}
              role="img"
              aria-label={`Listed on ${sourceName(key)}`}
              title={sourceName(key)}
            >
              <Globe aria-hidden="true" className="size-3.5" />
            </span>
          ))}
        </li>
        {item.hasConflicts && (
          <li data-testid="conflict-marker" className="flex items-center gap-1 text-warning">
            <AlertTriangle aria-hidden="true" className="size-3.5" />
            Sources disagree
          </li>
        )}
      </ul>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={whyOpen}
          aria-controls={whyId}
          onClick={() => {
            setWhyOpen((open) => !open);
          }}
          className="flex items-center gap-1 text-sm text-accent hover:underline"
        >
          <ChevronDown aria-hidden="true" className={`size-3.5 ${whyOpen ? 'rotate-180' : ''}`} />
          Why relevant?
        </button>
        <span className="flex-1" />
        <button
          type="button"
          aria-pressed={item.watchlisted}
          aria-keyshortcuts="S"
          onClick={onSave}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
        >
          <Star
            aria-hidden="true"
            className={`size-4 ${item.watchlisted ? 'fill-current text-accent' : ''}`}
          />
          {item.watchlisted ? 'Saved' : 'Save'}
        </button>
        <button
          type="button"
          onClick={onHide}
          className="flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-surface-hover"
        >
          <EyeOff aria-hidden="true" className="size-4" />
          Hide
        </button>
        <button
          type="button"
          disabled
          aria-disabled="true"
          aria-keyshortcuts="A"
          aria-label={`Assign — ${ASSIGN_LATER}`}
          title={ASSIGN_LATER}
          className="flex cursor-not-allowed items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-subtle"
        >
          <UserPlus aria-hidden="true" className="size-4" />
          Assign
        </button>
      </div>

      {whyOpen && (
        <ul
          id={whyId}
          aria-label="Why relevant"
          className="mt-2 list-disc pl-5 text-sm text-fg-muted"
        >
          {item.reasons.map((reason) => (
            // WP-15b's sentences are shown as written; the UI never rewrites them.
            <li key={`${reason.code}-${reason.text}`}>{reason.text}</li>
          ))}
        </ul>
      )}
    </article>
  );
}
