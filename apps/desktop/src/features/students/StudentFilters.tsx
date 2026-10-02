import {
  PROGRAM_LABELS,
  STUDENT_PROGRAMS,
  STUDENT_STATUSES,
  STUDENT_STATUS_LABELS,
  type StudentProgram,
  type StudentStatus,
} from '@compintel/contracts';
import { Search, UserCheck, X } from 'lucide-react';
import { useId } from 'react';

/**
 * The list's filters (WP-17 step 6): search by name, roll number or e-mail, and
 * chips for programme, status and "My students"; branch, graduation year and a
 * skill or interest as choices from what the list actually holds.
 */

export interface StudentFilterState {
  readonly text: string;
  readonly programs: readonly StudentProgram[];
  readonly statuses: readonly StudentStatus[];
  readonly branch: string;
  readonly graduationYear: string;
  readonly tag: string;
  readonly mine: boolean;
}

export const NO_FILTERS: StudentFilterState = {
  text: '',
  programs: [],
  statuses: [],
  branch: '',
  graduationYear: '',
  tag: '',
  mine: false,
};

export function hasFilters(filters: StudentFilterState): boolean {
  return JSON.stringify(filters) !== JSON.stringify(NO_FILTERS);
}

const toggle = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((item) => item !== value) : [...list, value];

function Chip(props: {
  readonly pressed: boolean;
  readonly onClick: () => void;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return (
    <button
      type="button"
      aria-pressed={props.pressed}
      onClick={props.onClick}
      className={`rounded-full border px-2.5 py-0.5 text-sm ${
        props.pressed
          ? 'border-accent bg-accent-surface font-medium text-fg'
          : 'border-line text-fg-muted hover:bg-surface-hover'
      }`}
    >
      {props.children}
    </button>
  );
}

export interface StudentFiltersProps {
  readonly filters: StudentFilterState;
  readonly branches: readonly string[];
  readonly graduationYears: readonly number[];
  readonly searchRef: React.Ref<HTMLInputElement>;
  readonly onChange: (next: StudentFilterState) => void;
}

export function StudentFilters({
  filters,
  branches,
  graduationYears,
  searchRef,
  onChange,
}: StudentFiltersProps): React.JSX.Element {
  const searchId = useId();
  const branchId = useId();
  const yearId = useId();
  const tagId = useId();
  const set = (patch: Partial<StudentFilterState>): void => {
    onChange({ ...filters, ...patch });
  };
  return (
    <div className="flex flex-col gap-3" role="search" aria-label="Filter students">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={searchId} className="sr-only">
          Search students by name, roll number or e-mail
        </label>
        <div className="flex min-w-64 flex-1 items-center gap-2 rounded-md border border-line bg-surface px-2">
          <Search aria-hidden="true" className="size-4 text-fg-subtle" />
          <input
            id={searchId}
            ref={searchRef}
            type="search"
            value={filters.text}
            placeholder="Search name, roll number or e-mail"
            onChange={(event) => {
              set({ text: event.target.value });
            }}
            className="w-full bg-transparent py-1.5 text-fg outline-none"
          />
        </div>
        <Chip
          pressed={filters.mine}
          onClick={() => {
            set({ mine: !filters.mine });
          }}
        >
          <span className="inline-flex items-center gap-1">
            <UserCheck aria-hidden="true" className="size-3.5" />
            My students
          </span>
        </Chip>
        {hasFilters(filters) && (
          <button
            type="button"
            onClick={() => {
              onChange(NO_FILTERS);
            }}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-sm text-fg-muted hover:bg-surface-hover"
          >
            <X aria-hidden="true" className="size-3.5" />
            Clear filters
          </button>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Programme">
        <span className="text-sm text-fg-subtle">Programme</span>
        {STUDENT_PROGRAMS.map((program) => (
          <Chip
            key={program}
            pressed={filters.programs.includes(program)}
            onClick={() => {
              set({ programs: toggle(filters.programs, program) });
            }}
          >
            {PROGRAM_LABELS[program]}
          </Chip>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2" role="group" aria-label="Status">
          <span className="text-sm text-fg-subtle">Status</span>
          {STUDENT_STATUSES.map((status) => (
            <Chip
              key={status}
              pressed={filters.statuses.includes(status)}
              onClick={() => {
                set({ statuses: toggle(filters.statuses, status) });
              }}
            >
              {STUDENT_STATUS_LABELS[status]}
            </Chip>
          ))}
        </div>
        <label htmlFor={branchId} className="text-sm text-fg-subtle">
          Branch
        </label>
        <select
          id={branchId}
          value={filters.branch}
          onChange={(event) => {
            set({ branch: event.target.value });
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">Any branch</option>
          {branches.map((branch) => (
            <option key={branch} value={branch}>
              {branch}
            </option>
          ))}
        </select>
        <label htmlFor={yearId} className="text-sm text-fg-subtle">
          Graduation year
        </label>
        <select
          id={yearId}
          value={filters.graduationYear}
          onChange={(event) => {
            set({ graduationYear: event.target.value });
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">Any year</option>
          {graduationYears.map((year) => (
            <option key={year} value={String(year)}>
              {year}
            </option>
          ))}
        </select>
        <label htmlFor={tagId} className="text-sm text-fg-subtle">
          Skill or interest
        </label>
        <input
          id={tagId}
          type="text"
          value={filters.tag}
          placeholder="e.g. Python"
          onChange={(event) => {
            set({ tag: event.target.value });
          }}
          className="w-36 rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
      </div>
    </div>
  );
}
