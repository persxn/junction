import type { StudentDetail } from '@compintel/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UserCheck, UserMinus, UserPlus } from 'lucide-react';

import { isApiProblem } from '../../api/problem.js';
import { endMentorship, startMentorship } from '../../api/students.js';
import { useAuth } from '../../auth/auth-context.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { dayText } from './labels.js';
import { studentKey } from './use-student-actions.js';

/**
 * A student's mentors (R91): the open mentorships first, then the ended ones
 * with their dates — ending keeps the record. A professor starts and ends their
 * own mentorship; an administrator may end anyone's.
 */
export function MentorsSection({
  student,
}: {
  readonly student: StudentDetail;
}): React.JSX.Element {
  const { me } = useAuth();
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const myId = me?.user.id;
  const isAdmin = me?.roles.includes('ADMINISTRATOR') === true;
  const open = student.mentors.filter((mentor) => mentor.endedAt === null);
  const ended = student.mentors.filter((mentor) => mentor.endedAt !== null);
  const iMentor = open.some((mentor) => mentor.userId === myId);
  const done = (saved: StudentDetail): void => {
    client.setQueryData(studentKey(student.id), saved);
    void client.invalidateQueries({ queryKey: ['students', 'list'] });
  };
  const complain = (cause: unknown): void => {
    toast.show({
      tone: 'danger',
      title: 'The mentorship was not changed',
      description: isApiProblem(cause) ? (cause.detail ?? cause.title) : String(cause),
    });
  };
  const start = useMutation({
    mutationFn: () => startMentorship(connection, student.id, {}),
    onSuccess: done,
    onError: complain,
  });
  const end = useMutation({
    mutationFn: (mentorshipId: string) => endMentorship(connection, mentorshipId),
    onSuccess: done,
    onError: complain,
  });

  return (
    <section aria-labelledby="mentors-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h2 id="mentors-heading" className="text-md">
          Mentors
        </h2>
        {student.erasedAt === null && !iMentor && (
          <button
            type="button"
            disabled={start.isPending}
            onClick={() => {
              start.mutate();
            }}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
          >
            <UserPlus aria-hidden="true" className="size-4" />
            Mentor this student
          </button>
        )}
      </div>
      {open.length === 0 ? (
        <p className="text-sm text-fg-muted">Nobody mentors this student at the moment.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {open.map((mentor) => (
            <li key={mentor.mentorshipId} className="flex items-center gap-2 text-sm">
              <UserCheck aria-hidden="true" className="size-4 text-success" />
              <span className="font-medium">{mentor.displayName}</span>
              <span className="text-fg-muted">since {dayText(mentor.startedAt)}</span>
              {(mentor.userId === myId || isAdmin) && (
                <button
                  type="button"
                  disabled={end.isPending}
                  onClick={() => {
                    end.mutate(mentor.mentorshipId);
                  }}
                  className="ml-auto flex items-center gap-1 rounded-md px-2 py-0.5 text-fg-muted hover:bg-surface-hover"
                >
                  <UserMinus aria-hidden="true" className="size-3.5" />
                  {mentor.userId === myId
                    ? 'Stop mentoring'
                    : `End ${mentor.displayName}’s mentorship`}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {ended.length > 0 && (
        <details className="text-sm text-fg-muted">
          <summary className="cursor-pointer">Earlier mentors ({ended.length})</summary>
          <ul className="mt-1 flex flex-col gap-1">
            {ended.map((mentor) => (
              <li key={mentor.mentorshipId}>
                {mentor.displayName}, {dayText(mentor.startedAt)} –{' '}
                {dayText(mentor.endedAt ?? mentor.startedAt)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
