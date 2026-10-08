import type { TeamListItem } from '@compintel/contracts';
import { UserCheck } from 'lucide-react';

import { useRovingRows } from '../../lib/roving-rows.js';
import { TeamStatusBadge } from './labels.js';
import { coverageText } from './team-model.js';

/**
 * The dense team table (§16.2, §16.3's keyboard model): name · members ·
 * primary mentor · coverage in words · status. J/K move, Enter opens.
 */

export interface TeamTableProps {
  readonly items: readonly TeamListItem[];
  readonly onOpen: (item: TeamListItem) => void;
  readonly keysEnabled: boolean;
}

export function TeamTable({ items, onOpen, keysEnabled }: TeamTableProps): React.JSX.Element {
  const roving = useRovingRows(items, keysEnabled);
  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">
        Teams. Use J and K to move between rows and Enter to open one.
      </caption>
      <thead>
        <tr className="border-b border-line text-fg-subtle">
          <th scope="col" className="py-2 pr-3 font-medium">
            Team
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Members
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Primary mentor
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Skill coverage
          </th>
          <th scope="col" className="py-2 font-medium">
            Status
          </th>
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
              <span className="font-medium text-fg">{item.name}</span>
              {item.isMine && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-accent">
                  <UserCheck aria-hidden="true" className="size-3" />
                  Mine
                </span>
              )}
            </td>
            <td className="py-2 pr-3">{item.memberCount}</td>
            <td className="py-2 pr-3 text-fg-muted">{item.primaryMentor?.displayName ?? 'None'}</td>
            <td className="py-2 pr-3 text-fg-muted">{coverageText(item.coverage)}</td>
            <td className="py-2">
              <TeamStatusBadge status={item.status} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
