import type { StudentListItem } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { useEffect, useId, useState } from 'react';

import { listStudents } from '../../api/students.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { alsoIn } from './team-model.js';

/**
 * A typeahead over ACTIVE students (R95: only they join), for "Add a member" and
 * the create form. An ARIA combobox: type to search, ↓/↑ to move, Enter to pick,
 * Esc to clear. Each option says how many teams the student is already in.
 */

export interface StudentPickerProps {
  readonly label: string;
  /** Students already chosen or already members. */
  readonly exclude: ReadonlySet<string>;
  readonly onPick: (student: StudentListItem) => void;
  readonly disabled?: boolean;
  /** Why it is off, read with the field (§10.1: explained, not hidden). */
  readonly describedBy?: string;
}

function useDebounced(value: string, ms: number): string {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => {
      setSettled(value);
    }, ms);
    return () => {
      clearTimeout(timer);
    };
  }, [value, ms]);
  return settled;
}

export function StudentPicker({
  label,
  exclude,
  onPick,
  disabled = false,
  describedBy,
}: StudentPickerProps): React.JSX.Element {
  const connection = useBackendConnection();
  const inputId = useId();
  const listId = useId();
  const [text, setText] = useState('');
  const [active, setActive] = useState(0);
  const settled = useDebounced(text.trim(), 200);
  const results = useQuery({
    queryKey: ['students', 'list', 'picker', settled],
    queryFn: () => listStudents(connection, { text: settled, statuses: ['ACTIVE'], limit: 8 }),
    enabled: settled !== '' && !disabled,
  });
  const options = (results.data?.items ?? []).filter((student) => !exclude.has(student.id));
  // Only answers for what is in the field now: a list for the last word typed
  // would let Enter pick a student the user is no longer looking for.
  const answered = text.trim() !== '' && settled === text.trim() && results.data !== undefined;
  const open = answered && options.length > 0;
  const current = options[Math.min(active, options.length - 1)];

  const pick = (student: StudentListItem): void => {
    onPick(student);
    setText('');
    setActive(0);
  };

  return (
    <div className="relative flex flex-col gap-1">
      <label htmlFor={inputId} className="text-sm font-medium">
        {label}
      </label>
      <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2">
        <Search aria-hidden="true" className="size-4 text-fg-subtle" />
        <input
          id={inputId}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={
            open && current !== undefined ? `${listId}-${current.id}` : undefined
          }
          aria-describedby={describedBy}
          disabled={disabled}
          value={text}
          placeholder="Type a name or roll number"
          onChange={(event) => {
            setText(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((index) => Math.min(options.length - 1, index + 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              if (open && current !== undefined) pick(current);
            } else if (event.key === 'Escape' && text !== '') {
              event.stopPropagation();
              setText('');
            }
          }}
          className="w-full bg-transparent py-1.5 text-fg outline-none disabled:cursor-not-allowed"
        />
      </div>
      {answered && options.length === 0 && (
        <p role="status" className="text-sm text-fg-muted">
          No active student matches “{text.trim()}”.
        </p>
      )}
      {open && (
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label}: matching students`}
          className="absolute top-full left-0 z-30 mt-1 flex max-h-72 w-full flex-col overflow-auto rounded-lg border border-line bg-surface-raised p-1 shadow-[var(--ci-shadow-popover)]"
        >
          {options.map((student) => {
            const note = alsoIn(student.teamCount);
            return (
              <li
                key={student.id}
                id={`${listId}-${student.id}`}
                role="option"
                aria-selected={student.id === current?.id}
                onMouseDown={(event) => {
                  event.preventDefault();
                  pick(student);
                }}
                className="flex cursor-pointer flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1.5 text-sm aria-selected:bg-accent-surface"
              >
                <span className="font-medium">{student.fullName}</span>
                <span className="font-mono text-fg-muted">{student.universityId}</span>
                {note !== undefined && <span className="text-xs text-fg-muted">{note}</span>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
