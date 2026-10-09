import type { DueItem, UrgencyBucket } from '@compintel/contracts';
import { DEFAULT_SEARCH } from '../discover/search-state.js';
import { Link } from '@tanstack/react-router';
import {
  AlarmClock,
  Calendar,
  CalendarClock,
  CalendarDays,
  CalendarX,
  type LucideIcon,
} from 'lucide-react';

import { dateText, urgencyText } from './deadline-model.js';

/** One Radar row (§12, WP-22): urgency as icon + words, label, owner links, source, honest date. */

const ICONS: Readonly<Record<UrgencyBucket, LucideIcon>> = {
  OVERDUE: CalendarX,
  TODAY: AlarmClock,
  DAYS_3: CalendarClock,
  DAYS_7: CalendarDays,
  LATER: Calendar,
};

const TONES: Readonly<Record<UrgencyBucket, string>> = {
  OVERDUE: 'text-danger',
  TODAY: 'text-warning',
  DAYS_3: 'text-accent',
  DAYS_7: 'text-info',
  LATER: 'text-fg-muted',
};

export function DeadlineRow({
  item,
  now,
}: {
  readonly item: DueItem;
  readonly now: number;
}): React.JSX.Element {
  const Icon = ICONS[item.bucket];
  return (
    <li className="flex flex-col gap-0.5 rounded-md border border-line px-3 py-2 text-sm">
      <span className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-1 font-medium">
          <Icon aria-hidden="true" className={`size-4 ${TONES[item.bucket]}`} />
          {urgencyText(item, now)}
        </span>
        <span>{item.label}</span>
        <span className="text-fg-muted">· {dateText(item)}</span>
      </span>
      <span className="flex flex-wrap items-center gap-x-2 text-xs text-fg-muted">
        {item.engagementId !== null && item.competitionName !== null && (
          <Link
            to="/competitions/$competitionId"
            params={{ competitionId: item.engagementId }}
            className="text-fg hover:underline"
          >
            {item.competitionName}
          </Link>
        )}
        {item.teamId !== null && item.teamName !== null && (
          <Link to="/teams/$teamId" params={{ teamId: item.teamId }} className="hover:underline">
            {item.teamName}
          </Link>
        )}
        {item.engagementId === null && (
          <Link
            to="/discover/event/$eventId"
            params={{ eventId: item.eventId }}
            search={DEFAULT_SEARCH}
            className="text-fg hover:underline"
          >
            {item.eventTitle}
          </Link>
        )}
        <span>{item.sourceLabel}</span>
      </span>
    </li>
  );
}
