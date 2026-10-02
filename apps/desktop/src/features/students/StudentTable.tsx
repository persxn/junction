import type { StudentListItem } from '@compintel/contracts';
import { UserCheck } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { useGlobalHotkeys, type Hotkey } from '../../lib/hotkeys.js';
import { programLabel, StatusBadge } from './labels.js';

/**
 * The dense student table (§16.2, §16.3's keyboard model): one row is the tab
 * stop, J and K move it, Enter opens the student. Skills show as words, the
 * caller's own students carry a "Mine" marker with an icon.
 */

export interface StudentTableProps {
  readonly items: readonly StudentListItem[];
  readonly onOpen: (item: StudentListItem) => void;
  readonly keysEnabled: boolean;
}

export function StudentTable({ items, onOpen, keysEnabled }: StudentTableProps): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | undefined>(undefined);
  const rows = useRef(new Map<string, HTMLTableRowElement>());
  const selected = items.find((item) => item.id === selectedId) ?? items[0];

  const select = useCallback((item: StudentListItem | undefined): void => {
    if (item === undefined) return;
    setSelectedId(item.id);
    const row = rows.current.get(item.id);
    row?.focus();
    row?.scrollIntoView({ block: 'nearest' });
  }, []);

  const hotkeys = useMemo<readonly Hotkey[]>(() => {
    if (!keysEnabled) return [];
    const index = selected === undefined ? -1 : items.indexOf(selected);
    return [
      {
        key: 'j',
        onPress: () => {
          select(items[Math.min(items.length - 1, index + 1)]);
        },
      },
      {
        key: 'k',
        onPress: () => {
          select(items[Math.max(0, index - 1)]);
        },
      },
    ];
  }, [keysEnabled, items, selected, select]);
  useGlobalHotkeys(hotkeys);

  return (
    <table className="w-full border-collapse text-left text-sm">
      <caption className="sr-only">
        Students. Use J and K to move between rows and Enter to open one.
      </caption>
      <thead>
        <tr className="border-b border-line text-fg-subtle">
          <th scope="col" className="py-2 pr-3 font-medium">
            Name
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Roll number
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Programme
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Graduates
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Status
          </th>
          <th scope="col" className="py-2 pr-3 font-medium">
            Skills and interests
          </th>
          <th scope="col" className="py-2 font-medium">
            Mentors
          </th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr
            key={item.id}
            ref={(element) => {
              if (element === null) rows.current.delete(item.id);
              else rows.current.set(item.id, element);
            }}
            tabIndex={item.id === selected?.id ? 0 : -1}
            data-selected={item.id === selected?.id}
            onFocus={() => {
              setSelectedId(item.id);
            }}
            onClick={() => {
              onOpen(item);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') onOpen(item);
            }}
            className="cursor-pointer border-b border-line outline-none hover:bg-surface-hover focus-visible:bg-accent-surface data-[selected=true]:bg-surface-hover"
          >
            <td className="py-2 pr-3">
              <span className="font-medium text-fg">{item.fullName}</span>
              {item.preferredName !== null && (
                <span className="text-fg-muted"> ({item.preferredName})</span>
              )}
              {item.isMine && (
                <span className="ml-2 inline-flex items-center gap-1 text-xs text-accent">
                  <UserCheck aria-hidden="true" className="size-3" />
                  Mine
                </span>
              )}
            </td>
            <td className="py-2 pr-3 font-mono text-fg-muted">{item.universityId}</td>
            <td className="py-2 pr-3">
              {programLabel(item.program)}
              {item.branch !== null && <span className="text-fg-muted"> · {item.branch}</span>}
            </td>
            <td className="py-2 pr-3">{item.graduationYear ?? '—'}</td>
            <td className="py-2 pr-3">
              <StatusBadge status={item.status} />
            </td>
            <td className="py-2 pr-3 text-fg-muted">
              {item.tags.length === 0
                ? '—'
                : item.tags
                    .slice(0, 3)
                    .map((tag) => tag.name)
                    .join(', ')}
              {item.tags.length > 3 && ` +${String(item.tags.length - 3)}`}
            </td>
            <td className="py-2 text-fg-muted">
              {item.mentorNames.length === 0 ? 'None' : item.mentorNames.join(', ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
