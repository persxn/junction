import type { CompetitionListItem } from '@compintel/contracts';

import { useRovingRows } from '../../lib/roving-rows.js';
import { EVENT_TYPE_LABELS } from '../discover/labels.js';
import { whoOf } from './board-model.js';
import { CompetitionStatus, KIND_LABELS } from './labels.js';
import { OutcomeBadge } from '../outcomes/OutcomeBadge.js';
import { ProgressHealth } from '../workflows/ProgressHealth.js';
import { NextDeadline } from './NextDeadline.js';

/** The list view (WP-19 step 6): a dense table, J/K to move, Enter to open. */

export interface CompetitionTableProps {
  readonly items: readonly CompetitionListItem[];
  readonly now: number;
  readonly onOpen: (item: CompetitionListItem) => void;
}

export function CompetitionTable({ items, now, onOpen }: CompetitionTableProps): React.JSX.Element {
  const roving = useRovingRows(items, true);
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">
        Competitions. Use J and K to move between rows and Enter to open one.
      </caption>
      <thead>
        <tr className="border-b border-line text-fg-subtle">
          {['Event', 'Team or student', 'Primary mentor', 'Next date', 'Progress', 'Status'].map(
            (head) => (
              <th key={head} scope="col" className="py-2 pr-3 font-medium">
                {head}
              </th>
            ),
          )}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            {...roving.rowProps(item)}
            onClick={() => {
              onOpen(item);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(item);
            }}
            className="cursor-pointer border-b border-line outline-none hover:bg-surface-hover focus-visible:bg-accent-surface data-[selected=true]:bg-surface-hover"
          >
            <td className="py-2 pr-3">
              <span className="font-medium">{item.event.title}</span>
              <span className="block text-xs text-fg-muted">
                {EVENT_TYPE_LABELS[item.event.eventType]}
              </span>
            </td>
            <td className="py-2 pr-3">
              {whoOf(item)}
              <span className="block text-xs text-fg-muted">{KIND_LABELS[item.kind]}</span>
            </td>
            <td className="py-2 pr-3 text-fg-muted">{item.primaryMentor?.displayName ?? 'None'}</td>
            <td className="py-2 pr-3">
              <NextDeadline next={item.nextDeadline} now={now} />
            </td>
            <td className="py-2 pr-3">
              <ProgressHealth item={item} />
            </td>
            <td className="py-2">
              <CompetitionStatus status={item.status} />
              {item.result !== null && (
                <span className="block text-xs">
                  <OutcomeBadge result={item.result} />
                </span>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
