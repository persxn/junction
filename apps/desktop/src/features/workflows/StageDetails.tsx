import type { WorkflowStage, WorkflowView } from '@compintel/contracts';
import { useId, useState } from 'react';

import { fromZonedInput, toZonedInput } from './template-choice.js';
import type { RunWrite } from './use-workflow.js';

/**
 * A stage's details (WP-20a step 7): its date — a person's date is MANUAL and
 * never recomputed (R100) — progress set by hand (R99's override, 0 counts),
 * who works on it (active roster members only), and notes.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1 text-sm disabled:opacity-60';
const BUTTON =
  'rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover disabled:opacity-50';

export function StageDetails({
  view,
  stage,
  run,
}: {
  readonly view: WorkflowView;
  readonly stage: WorkflowStage;
  readonly run: RunWrite;
}): React.JSX.Element {
  const id = useId();
  const editable = view.canEdit;
  const [due, setDue] = useState(toZonedInput(stage.dueAt));
  const [override, setOverride] = useState(
    stage.progressOverride === null ? '' : String(stage.progressOverride),
  );
  const [people, setPeople] = useState(() => new Set(stage.assignees.map((a) => a.studentId)));
  const [notes, setNotes] = useState(stage.notes ?? '');
  const percent = Number(override);
  const validPercent =
    override !== '' && Number.isInteger(percent) && percent >= 0 && percent <= 100;

  const write = (
    path: string,
    body: Record<string, unknown>,
    failure: string,
    method?: 'PATCH' | 'PUT',
  ) =>
    void run({
      view,
      path,
      body: { ...body, version: stage.version },
      failure,
      ...(method === undefined ? {} : { method }),
    });

  return (
    <details className="text-sm">
      <summary className="cursor-pointer text-fg-muted">Date, progress, people and notes</summary>
      <div className="mt-2 flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={`${id}-due`} className="flex flex-col gap-0.5">
            Due
            <input
              id={`${id}-due`}
              type="datetime-local"
              value={due}
              disabled={!editable}
              onChange={(event) => {
                setDue(event.target.value);
              }}
              className={FIELD}
            />
          </label>
          <button
            type="button"
            className={BUTTON}
            disabled={
              !editable || fromZonedInput(due) === null || due === toZonedInput(stage.dueAt)
            }
            onClick={() => {
              write(
                `stages/${stage.id}`,
                { dueAt: fromZonedInput(due) },
                'The date was not saved',
                'PATCH',
              );
            }}
          >
            Save date
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={!editable || stage.dueAt === null}
            onClick={() => {
              setDue('');
              write(`stages/${stage.id}`, { dueAt: null }, 'The date was not cleared', 'PATCH');
            }}
          >
            Clear date
          </button>
          <span className="text-xs text-fg-muted">
            {stage.dueOrigin === 'RULE'
              ? 'From the event’s dates'
              : stage.dueOrigin === 'MANUAL'
                ? 'Set by hand — kept when the event changes'
                : 'No date'}
          </span>
        </div>

        <div className="flex flex-wrap items-end gap-2">
          <label htmlFor={`${id}-override`} className="flex flex-col gap-0.5">
            Progress by hand (0–100)
            <input
              id={`${id}-override`}
              type="number"
              min={0}
              max={100}
              value={override}
              disabled={!editable}
              onChange={(event) => {
                setOverride(event.target.value);
              }}
              className={`${FIELD} w-24`}
            />
          </label>
          <button
            type="button"
            className={BUTTON}
            disabled={!editable || !validPercent}
            onClick={() => {
              write(
                `stages/${stage.id}/override`,
                { progressOverride: percent },
                'The progress was not saved',
              );
            }}
          >
            Set
          </button>
          <button
            type="button"
            className={BUTTON}
            disabled={!editable || stage.progressOverride === null}
            onClick={() => {
              setOverride('');
              write(
                `stages/${stage.id}/override`,
                { progressOverride: null },
                'The progress was not cleared',
              );
            }}
          >
            Use the tasks
          </button>
        </div>

        <fieldset className="flex flex-col gap-1">
          <legend>Who works on it</legend>
          {view.roster.length === 0 ? (
            <p className="text-fg-muted">Nobody is on the roster.</p>
          ) : (
            <div className="flex flex-wrap gap-3">
              {view.roster.map((person) => (
                <label key={person.studentId} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    disabled={!editable}
                    checked={people.has(person.studentId)}
                    onChange={(event) => {
                      const next = new Set(people);
                      if (event.target.checked) next.add(person.studentId);
                      else next.delete(person.studentId);
                      setPeople(next);
                    }}
                  />
                  {person.fullName}
                </label>
              ))}
              <button
                type="button"
                className={BUTTON}
                disabled={!editable}
                onClick={() => {
                  write(
                    `stages/${stage.id}/assignees`,
                    { studentIds: [...people] },
                    'The people were not saved',
                    'PUT',
                  );
                }}
              >
                Save people
              </button>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-notes`}>Notes</label>
          <textarea
            id={`${id}-notes`}
            rows={2}
            value={notes}
            disabled={!editable}
            onChange={(event) => {
              setNotes(event.target.value);
            }}
            className={FIELD}
          />
          <button
            type="button"
            className={`${BUTTON} w-fit`}
            disabled={!editable || notes === (stage.notes ?? '')}
            onClick={() => {
              write(
                `stages/${stage.id}`,
                { notes: notes.trim() === '' ? null : notes },
                'The notes were not saved',
                'PATCH',
              );
            }}
          >
            Save notes
          </button>
        </div>
      </div>
    </details>
  );
}
