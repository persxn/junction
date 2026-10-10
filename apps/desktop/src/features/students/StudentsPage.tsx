import type { StudentListQueryInput } from '@compintel/contracts';
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { FileUp, GraduationCap, Loader2, UserPlus } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { listStudents } from '../../api/students.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import {
  hasFilters,
  NO_FILTERS,
  StudentFilters,
  type StudentFilterState,
} from './StudentFilters.js';
import { StudentTable } from './StudentTable.js';
import { useInstallation } from '../../app/installation.js';

/**
 * Students (§16.1 rail item, §16.2, WP-17 step 6).
 *
 * Every professor sees every student of the institution (R91); "My students"
 * narrows the list to the ones you mentor. 50 a page, "Load more" for the next,
 * `/` to search, J/K/Enter to move and open.
 */

export const STUDENT_LIST_KEY = ['students', 'list'] as const;

function useDebounced<T>(value: T, ms: number): T {
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

function toQuery(filters: StudentFilterState): StudentListQueryInput {
  return {
    ...(filters.text.trim() === '' ? {} : { text: filters.text.trim() }),
    ...(filters.programs.length === 0 ? {} : { programs: [...filters.programs] }),
    ...(filters.statuses.length === 0 ? {} : { statuses: [...filters.statuses] }),
    ...(filters.branch === '' ? {} : { branches: [filters.branch] }),
    ...(filters.graduationYear === '' ? {} : { graduationYears: [Number(filters.graduationYear)] }),
    ...(filters.tag.trim() === '' ? {} : { tag: filters.tag.trim() }),
    ...(filters.mine ? { mine: true } : {}),
    limit: 50,
  };
}

export function StudentsPage(): React.JSX.Element {
  const { labels } = useInstallation();
  const connection = useBackendConnection();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<StudentFilterState>(NO_FILTERS);
  const settled = useDebounced(filters, 250);
  const query = useMemo(() => toQuery(settled), [settled]);
  const searchRef = useRef<HTMLInputElement>(null);

  const list = useInfiniteQuery({
    queryKey: [...STUDENT_LIST_KEY, query],
    queryFn: ({ pageParam }) =>
      listStudents(connection, {
        ...query,
        ...(pageParam === undefined ? {} : { cursor: pageParam }),
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
  });
  const items = useMemo(() => list.data?.pages.flatMap((page) => page.items) ?? [], [list.data]);
  const first = list.data?.pages[0];

  return (
    <section aria-labelledby="students-heading" className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 id="students-heading" className="font-display text-xl">
            {labels.students}
          </h1>
          <p className="text-fg-muted">
            {first === undefined
              ? labels.studentsIntro
              : `${String(first.total)} ${(first.total === 1 ? labels.student : labels.students).toLowerCase()}${hasFilters(settled) ? ' match these filters' : ''}.`}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/students/import"
            className="flex items-center gap-2 rounded-md border border-line px-3 py-2 hover:bg-surface-hover"
          >
            <FileUp aria-hidden="true" className="size-4" />
            Import a list
          </Link>
          <Link
            to="/students/new"
            className="flex items-center gap-2 rounded-md bg-accent px-3 py-2 font-medium text-on-accent hover:bg-accent-hover"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Add a student
          </Link>
        </div>
      </header>

      <Guide id="students-list" title="How the student list works">
        <p>
          Every professor sees and can edit every student of the institution.{' '}
          <strong>My students</strong> shows only the ones you mentor — you become a student’s
          mentor when you add or import them, or from their page.
        </p>
        <p>
          Search finds a name, a roll number or a college e-mail. Press <kbd>J</kbd> and{' '}
          <kbd>K</kbd> to move through the list and <kbd>Enter</kbd> to open a student.
        </p>
        <p>
          Have a spreadsheet already? <strong>Import a list</strong> reads a .csv or .xlsx file and
          shows every row before anything is saved.
        </p>
      </Guide>

      <StudentFilters
        filters={filters}
        branches={first?.facets.branches ?? []}
        graduationYears={first?.facets.graduationYears ?? []}
        searchRef={searchRef}
        onChange={setFilters}
      />

      {list.isPending && <Skeleton lines={6} label="Loading students" />}

      {list.isError && (
        <EmptyState
          icon={GraduationCap}
          title="The student list could not be loaded"
          description={
            isApiProblem(list.error) ? (list.error.detail ?? list.error.title) : String(list.error)
          }
          action={{
            label: 'Try again',
            onAction: () => {
              void list.refetch();
            },
          }}
        />
      )}

      {first !== undefined && items.length === 0 && !hasFilters(settled) && (
        <EmptyState
          icon={GraduationCap}
          title="No students yet"
          description="Add the students you mentor one at a time, or import the department’s list from a spreadsheet."
          action={{
            label: 'Import a list',
            onAction: () => {
              void navigate({ to: '/students/import' });
            },
          }}
        />
      )}

      {first !== undefined && items.length === 0 && hasFilters(settled) && (
        <EmptyState
          icon={GraduationCap}
          title="No student matches these filters"
          description="Loosen a filter or clear them all."
          action={{
            label: 'Clear filters',
            onAction: () => {
              setFilters(NO_FILTERS);
            },
          }}
        />
      )}

      {items.length > 0 && (
        <StudentTable
          items={items}
          keysEnabled
          onOpen={(item) => {
            void navigate({ to: '/students/$studentId', params: { studentId: item.id } });
          }}
        />
      )}

      {list.hasNextPage && (
        <button
          type="button"
          onClick={() => {
            void list.fetchNextPage();
          }}
          disabled={list.isFetchingNextPage}
          className="mx-auto flex items-center gap-2 rounded-md border border-line px-4 py-1.5 hover:bg-surface-hover disabled:opacity-60"
        >
          {list.isFetchingNextPage && (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          )}
          {list.isFetchingNextPage ? 'Loading…' : 'Load more'}
        </button>
      )}
    </section>
  );
}
