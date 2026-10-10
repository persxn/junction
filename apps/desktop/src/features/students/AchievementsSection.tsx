import type { StudentDetail } from '@compintel/contracts';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Award, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { addAchievement, deleteAchievement } from '../../api/students.js';
import { useToast } from '../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { studentKey } from './use-student-actions.js';

/**
 * Achievements from before Junction (§6.2 `student_achievements`). Results of
 * competitions run in the app arrive on their own under "Competitions and
 * outcomes"; this is for the history a professor already knows.
 */
export function AchievementsSection({
  student,
}: {
  readonly student: StudentDetail;
}): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const toast = useToast();
  const titleId = useId();
  const eventId = useId();
  const yearId = useId();
  const resultId = useId();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: '', eventName: '', year: '', result: '' });
  const readOnly = student.erasedAt !== null;

  const done = (saved: StudentDetail): void => {
    client.setQueryData(studentKey(student.id), saved);
  };
  const complain = (cause: unknown): void => {
    toast.show({
      tone: 'danger',
      title: 'The achievement was not saved',
      description: isApiProblem(cause) ? (cause.detail ?? cause.title) : String(cause),
    });
  };
  const add = useMutation({
    mutationFn: () =>
      addAchievement(connection, student.id, {
        title: form.title.trim(),
        eventName: form.eventName.trim() || null,
        year: form.year.trim() === '' ? null : Number(form.year),
        result: form.result.trim() || null,
      }),
    onSuccess: (saved) => {
      done(saved);
      setAdding(false);
      setForm({ title: '', eventName: '', year: '', result: '' });
    },
    onError: complain,
  });
  const remove = useMutation({
    mutationFn: (achievementId: string) => deleteAchievement(connection, student.id, achievementId),
    onSuccess: done,
    onError: complain,
  });
  const yearValid = form.year.trim() === '' || /^(19[5-9]\d|20\d\d)$/.test(form.year.trim());

  const field = (
    id: string,
    label: string,
    key: keyof typeof form,
    extra = {},
  ): React.JSX.Element => (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-fg-subtle">
        {label}
      </label>
      <input
        id={id}
        value={form[key]}
        onChange={(event) => {
          setForm({ ...form, [key]: event.target.value });
        }}
        className="rounded-md border border-line bg-surface px-2 py-1 text-sm"
        {...extra}
      />
    </div>
  );

  return (
    <section aria-labelledby="achievements-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 id="achievements-heading" className="text-md">
          Achievements before Junction
        </h2>
        {!readOnly && !adding && (
          <button
            type="button"
            onClick={() => {
              setAdding(true);
            }}
            className="flex items-center gap-1 rounded-md border border-line px-2.5 py-1 text-sm hover:bg-surface-hover"
          >
            <Plus aria-hidden="true" className="size-3.5" />
            Add an achievement
          </button>
        )}
      </div>
      {student.achievements.length === 0 && !adding && (
        <p className="text-sm text-fg-muted">
          None recorded. Add prizes and results from before Junction; results of competitions run
          here appear by themselves.
        </p>
      )}
      <ul className="flex flex-col gap-1.5">
        {student.achievements.map((achievement) => (
          <li key={achievement.id} className="flex items-center gap-2 text-sm">
            <Award aria-hidden="true" className="size-4 text-warning" />
            <span className="font-medium">{achievement.title}</span>
            <span className="text-fg-muted">
              {[achievement.eventName, achievement.result, achievement.year]
                .filter((part) => part !== null)
                .join(' · ')}
            </span>
            {!readOnly && (
              <button
                type="button"
                aria-label={`Remove “${achievement.title}”`}
                onClick={() => {
                  remove.mutate(achievement.id);
                }}
                className="ml-auto rounded p-1 text-fg-subtle hover:bg-surface-hover hover:text-danger"
              >
                <Trash2 aria-hidden="true" className="size-3.5" />
              </button>
            )}
          </li>
        ))}
      </ul>
      {adding && (
        <form
          className="flex flex-wrap items-end gap-2 rounded-md border border-line p-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (form.title.trim().length > 0 && yearValid) add.mutate();
          }}
        >
          {field(titleId, 'What (required)', 'title', { required: true, maxLength: 200 })}
          {field(eventId, 'Event', 'eventName', { maxLength: 200 })}
          {field(yearId, 'Year', 'year', { inputMode: 'numeric', 'aria-invalid': !yearValid })}
          {field(resultId, 'Result', 'result', { maxLength: 200 })}
          <button
            type="submit"
            disabled={add.isPending || form.title.trim().length === 0 || !yearValid}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false);
            }}
            className="rounded-md px-3 py-1.5 text-sm hover:bg-surface-hover"
          >
            Cancel
          </button>
          {!yearValid && <p className="w-full text-sm text-danger">A year looks like 2024.</p>}
        </form>
      )}
    </section>
  );
}
