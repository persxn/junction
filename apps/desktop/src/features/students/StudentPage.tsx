import type { StudentDetail } from '@compintel/contracts';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { ArrowLeft, Pencil, PauseCircle, PlayCircle, ShieldAlert, UserX } from 'lucide-react';
import { useState } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { eraseStudent, getStudent } from '../../api/students.js';
import { EmptyState } from '../../components/EmptyState.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { AchievementsSection } from './AchievementsSection.js';
import { EraseDialog } from './EraseDialog.js';
import { dayText, programLabel, StatusBadge } from './labels.js';
import { MentorsSection } from './MentorsSection.js';
import { TagEditor } from './TagEditor.js';
import { TeamsSection } from './TeamsSection.js';
import { CompetitionHistory } from '../outcomes/CompetitionHistory.js';
import { studentKey, useStudentActions } from './use-student-actions.js';

/**
 * The Student page (§16.2: profile · skills & interests · teams · competitions
 * & outcomes history). Teams are WP-18's; competitions with their outcomes come
 * from WP-21's history endpoint.
 */

function Profile({ student }: { readonly student: StudentDetail }): React.JSX.Element {
  const rows: [string, string][] = [
    ['Programme', programLabel(student.program)],
    ['Branch', student.branch ?? 'Not recorded'],
    [
      'Graduation year',
      student.graduationYear === null ? 'Not recorded' : String(student.graduationYear),
    ],
    ['Department', student.homeDepartmentName ?? 'Not recorded'],
    ['College e-mail', student.institutionalEmail ?? 'Not recorded'],
    ...(student.phone === undefined
      ? []
      : ([['Phone', student.phone ?? 'Not recorded']] as [string, string][])),
    ...(student.isExternal
      ? ([['From another institution', student.externalInstitution ?? 'Yes']] as [string, string][])
      : []),
    [
      'Privacy notice',
      student.privacyNoticeAckAt === null
        ? 'Not yet given'
        : `Given ${dayText(student.privacyNoticeAckAt)}`,
    ],
    ['Added', dayText(student.createdAt)],
  ];
  return (
    <section aria-labelledby="profile-heading" className="flex flex-col gap-3">
      <h2 id="profile-heading" className="text-md">
        Profile
      </h2>
      <dl className="grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1.5 text-sm">
        {rows.map(([term, value]) => (
          <div key={term} className="contents">
            <dt className="text-fg-subtle">{term}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {student.notes !== null && (
        <p className="rounded-md bg-surface-sunken p-3 text-sm">
          <span className="font-medium">Notes: </span>
          {student.notes}
        </p>
      )}
    </section>
  );
}

export function StudentPage(): React.JSX.Element {
  const { studentId } = useParams({ from: '/students/$studentId' });
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const actions = useStudentActions();
  const [erasing, setErasing] = useState(false);
  const student = useQuery({
    queryKey: studentKey(studentId),
    queryFn: () => getStudent(connection, studentId),
  });
  const erase = useMutation({
    mutationFn: (universityId: string) => eraseStudent(connection, studentId, universityId),
    onSuccess: (saved) => {
      client.setQueryData(studentKey(studentId), saved);
      void client.invalidateQueries({ queryKey: ['students', 'list'] });
      setErasing(false);
    },
  });

  if (student.isPending) return <Skeleton lines={8} label="Loading the student" />;
  if (student.isError) {
    return (
      <EmptyState
        icon={UserX}
        title="This student could not be loaded"
        description={
          isApiProblem(student.error)
            ? (student.error.detail ?? student.error.title)
            : String(student.error)
        }
        action={{
          label: 'Back to students',
          onAction: () => {
            void navigate({ to: '/students' });
          },
        }}
      />
    );
  }
  const data = student.data;
  const erased = data.erasedAt !== null;

  return (
    <article aria-labelledby="student-heading" className="flex flex-col gap-6">
      <Link
        to="/students"
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:text-fg"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        All students
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 id="student-heading" className="font-display text-xl">
            {data.fullName}
            {data.preferredName !== null && (
              <span className="text-fg-muted"> ({data.preferredName})</span>
            )}
          </h1>
          <p className="flex flex-wrap items-center gap-3 text-sm text-fg-muted">
            <span className="font-mono">{data.universityId}</span>
            <StatusBadge status={data.status} />
          </p>
        </div>
        {!erased && (
          <div className="flex flex-wrap gap-2">
            <Link
              to="/students/$studentId/edit"
              params={{ studentId }}
              className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
            >
              <Pencil aria-hidden="true" className="size-4" />
              Edit
            </Link>
            {data.canDeactivate && (
              <button
                type="button"
                onClick={() => {
                  actions.setActive(data, data.status !== 'ACTIVE');
                }}
                className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
              >
                {data.status === 'ACTIVE' ? (
                  <PauseCircle aria-hidden="true" className="size-4" />
                ) : (
                  <PlayCircle aria-hidden="true" className="size-4" />
                )}
                {data.status === 'ACTIVE' ? 'Deactivate' : 'Reactivate'}
              </button>
            )}
            {data.canErase && (
              <button
                type="button"
                onClick={() => {
                  setErasing(true);
                }}
                className="flex items-center gap-1.5 rounded-md border border-danger px-3 py-1.5 text-danger hover:bg-danger-surface"
              >
                <ShieldAlert aria-hidden="true" className="size-4" />
                Erase…
              </button>
            )}
          </div>
        )}
      </header>

      {erased && (
        <p role="status" className="rounded-md bg-surface-sunken p-3 text-sm">
          An administrator erased this student’s personal details on{' '}
          {dayText(data.erasedAt ?? data.createdAt)}. The record stays only so team and competition
          history keeps its shape.
        </p>
      )}

      <Guide id="student-page" title="What this page is for">
        <p>
          Everything Junction knows about one student. Skills carry a level — Beginner, Intermediate
          or Advanced — which team building (Teams) uses to suggest who covers what.
        </p>
        <p>
          <strong>Deactivate</strong> is for a student who has left or paused; it is reversible and
          keeps their history. Only a mentor or an administrator can do it. <strong>Erase</strong>{' '}
          is an administrator’s privacy deletion and cannot be undone.
        </p>
      </Guide>

      <Profile student={data} />
      <TagEditor student={data} />
      <MentorsSection student={data} />
      <AchievementsSection student={data} />
      <TeamsSection student={data} />
      <CompetitionHistory studentId={data.id} />

      {erasing && (
        <EraseDialog
          student={data}
          busy={erase.isPending}
          error={
            erase.error === null
              ? undefined
              : isApiProblem(erase.error)
                ? (erase.error.detail ?? erase.error.title)
                : String(erase.error)
          }
          onCancel={() => {
            setErasing(false);
            erase.reset();
          }}
          onErase={(universityId) => {
            erase.mutate(universityId);
          }}
        />
      )}
    </article>
  );
}
