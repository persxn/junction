import { useQuery } from '@tanstack/react-query';
import { Search, UserCheck, X } from 'lucide-react';
import { useId, useMemo, useState } from 'react';

import { listTeams } from '../../../api/teams.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { StudentPicker } from '../../teams/StudentPicker.js';
import type { StepProps } from './assign-model.js';

/**
 * Step "Team or students" (R96, §16.2): a team — your teams first, filtered
 * by typing — or one or more students, each becoming an individual entry.
 */
export function TeamOrStudentsStep({ draft, onChange }: StepProps): React.JSX.Element {
  const connection = useBackendConnection();
  const filterId = useId();
  const groupName = useId();
  const [filter, setFilter] = useState('');
  const teams = useQuery({
    queryKey: ['teams', 'list', { status: 'ACTIVE' }],
    queryFn: () => listTeams(connection, { status: 'ACTIVE' }),
    enabled: draft.mode === 'TEAM',
  });
  const shown = useMemo(() => {
    const text = filter.trim().toLowerCase();
    return [...(teams.data?.items ?? [])]
      .filter((team) => text === '' || team.name.toLowerCase().includes(text))
      .sort((a, b) => Number(b.isMine) - Number(a.isMine) || a.name.localeCompare(b.name));
  }, [teams.data, filter]);
  const chosen = useMemo(
    () => new Set(draft.students.map((student) => student.id)),
    [draft.students],
  );

  const mode = (next: 'TEAM' | 'STUDENTS'): void => {
    onChange({ mode: next, preview: undefined });
  };

  return (
    <div className="flex flex-col gap-3">
      <fieldset className="flex gap-4">
        <legend className="sr-only">Who takes part</legend>
        {(
          [
            ['TEAM', 'A team'],
            ['STUDENTS', 'Students, each on their own'],
          ] as const
        ).map(([value, label]) => (
          <label key={value} className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name={`${groupName}-mode`}
              checked={draft.mode === value}
              onChange={() => {
                mode(value);
              }}
            />
            {label}
          </label>
        ))}
      </fieldset>

      {draft.mode === 'TEAM' ? (
        <div className="flex flex-col gap-2">
          <label htmlFor={filterId} className="text-sm font-medium">
            Find a team
          </label>
          <div className="flex items-center gap-2 rounded-md border border-line bg-surface px-2">
            <Search aria-hidden="true" className="size-4 text-fg-subtle" />
            <input
              id={filterId}
              type="search"
              value={filter}
              placeholder="Type part of a team’s name"
              onChange={(event) => {
                setFilter(event.target.value);
              }}
              className="w-full bg-transparent py-1.5 outline-none"
            />
          </div>
          {teams.isPending && <p className="text-sm text-fg-muted">Loading teams…</p>}
          {teams.data !== undefined && shown.length === 0 && (
            <p className="text-sm text-fg-muted">
              No active team matches. Create one on the Teams screen, or choose students instead.
            </p>
          )}
          <div
            role="radiogroup"
            aria-label="Teams"
            className="flex max-h-56 flex-col gap-1 overflow-auto"
          >
            {shown.map((team) => (
              <label
                key={team.id}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-surface-hover has-checked:bg-accent-surface"
              >
                <input
                  type="radio"
                  name={`${groupName}-team`}
                  checked={draft.teamId === team.id}
                  onChange={() => {
                    onChange({ teamId: team.id, teamName: team.name, preview: undefined });
                  }}
                />
                <span className="font-medium">{team.name}</span>
                <span className="text-fg-muted">
                  {team.memberCount} {team.memberCount === 1 ? 'member' : 'members'}
                </span>
                {team.isMine && (
                  <span className="inline-flex items-center gap-1 text-xs text-accent">
                    <UserCheck aria-hidden="true" className="size-3" />
                    Mine
                  </span>
                )}
              </label>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <StudentPicker
            label="Add a student"
            exclude={chosen}
            onPick={(student) => {
              onChange({
                students: [...draft.students, { id: student.id, fullName: student.fullName }],
                preview: undefined,
              });
            }}
          />
          {draft.students.length === 0 ? (
            <p className="text-sm text-fg-muted">
              Each student you add gets a competition of their own, with you as primary mentor.
            </p>
          ) : (
            <ul aria-label="Chosen students" className="flex flex-wrap gap-2">
              {draft.students.map((student) => (
                <li
                  key={student.id}
                  className="inline-flex items-center gap-1 rounded-full border border-line px-2.5 py-0.5 text-sm"
                >
                  {student.fullName}
                  <button
                    type="button"
                    aria-label={`Take ${student.fullName} off the list`}
                    onClick={() => {
                      onChange({
                        students: draft.students.filter((other) => other.id !== student.id),
                        preview: undefined,
                      });
                    }}
                    className="rounded-full p-0.5 text-fg-muted hover:bg-surface-hover"
                  >
                    <X aria-hidden="true" className="size-3.5" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
