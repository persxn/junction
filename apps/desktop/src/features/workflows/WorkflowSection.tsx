import { STAGE_NAME_MAX, type EngagementStatus, type WorkflowView } from '@compintel/contracts';
import { CalendarClock, ListChecks, Plus } from 'lucide-react';
import { useId, useState } from 'react';

import { isApiProblem } from '../../api/problem.js';
import { Guide } from '../../components/Guide.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useNow } from '../../lib/use-now.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { formatDue } from './format.js';
import { HealthBadge } from './labels.js';
import { StageCard, stageDomId } from './StageCard.js';
import { useWorkflow, useWorkflowWrites, type RunWrite } from './use-workflow.js';
import { placementFor, progressText, reordered, type Direction } from './workflow-model.js';

/**
 * The Competition page's workflow (§16.2, WP-20a step 7): progress as a bar
 * with its number in words (or why there is none), schedule health as icon +
 * label + reason, R100's "Event deadline changed" banner, and the stages in
 * order. A competition still being considered has no workflow yet.
 */

export function WorkflowSection({
  competitionId,
  status,
}: {
  readonly competitionId: string;
  readonly status: EngagementStatus;
}): React.JSX.Element {
  const headingId = useId();
  const considering = status === 'CONSIDERING';
  const workflow = useWorkflow(competitionId, !considering);
  const run = useWorkflowWrites();

  let body: React.JSX.Element;
  if (considering) {
    body = (
      <p className="flex items-start gap-2 rounded-md border border-dashed border-line p-3 text-sm text-fg-muted">
        <ListChecks aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
        No workflow yet. Its stages and tasks are copied from a template when the competition is
        assigned.
      </p>
    );
  } else if (workflow.isPending) {
    body = <Skeleton lines={5} label="Loading the workflow" />;
  } else if (workflow.isError) {
    const missing = isApiProblem(workflow.error) && workflow.error.code === 'WORKFLOW_NOT_FOUND';
    body = (
      <p role={missing ? undefined : 'alert'} className="rounded-md bg-danger-surface p-3 text-sm">
        {missing
          ? 'This competition has no workflow.'
          : `The workflow did not load: ${problemText(workflow.error)}`}
      </p>
    );
  } else {
    body = <Workflow view={workflow.data} run={run} />;
  }

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <h2 id={headingId} className="text-md">
        Stages
      </h2>
      <Guide id="competition-workflow" title="How stages and progress work">
        <p>
          The stages and tasks were copied from a <strong>workflow template</strong> when the
          competition was assigned; editing the template later does not change them. Tick tasks as
          they are done; the stage starts on the first tick.
        </p>
        <p>
          <strong>Progress</strong> weighs each stage: a completed stage counts 100%, a stage set by
          hand counts that number, otherwise its ticked tasks do. Skipped stages do not count.{' '}
          <strong>Health</strong> is the first of Blocked, Overdue, At risk (due within 48 hours and
          under half done), On track and No dates.
        </p>
        <p>
          To reorder, focus a stage’s name or a task and press <kbd>Alt</kbd>+<kbd>↑</kbd> or{' '}
          <kbd>Alt</kbd>+<kbd>↓</kbd>, or use its <strong>⋮</strong> menu.
        </p>
      </Guide>
      {body}
    </section>
  );
}

function Workflow({ view, run }: { readonly view: WorkflowView; readonly run: RunWrite }) {
  const now = useNow();
  const addId = useId();
  const [name, setName] = useState('');

  const move = (stageId: string, direction: Direction): void => {
    const placement = placementFor(
      view.stages.map((stage) => stage.id),
      stageId,
      direction,
    );
    if (placement === undefined) return;
    void run({
      view,
      path: `stages/${stageId}/move`,
      body: { ...placement, version: view.version },
      failure: 'The stage was not moved',
      optimistic: { ...view, stages: reordered(view.stages, stageId, direction) },
    });
    requestAnimationFrame(() => {
      document.getElementById(stageDomId(stageId))?.focus();
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
          <span>
            Progress: <strong>{progressText(view)}</strong>
            {view.templateName !== null && (
              <span className="text-fg-muted"> · from the “{view.templateName}” template</span>
            )}
          </span>
          {view.health !== null && <HealthBadge health={view.health} reason={view.healthReason} />}
          {view.health === null && <span className="text-fg-muted">{view.healthReason}</span>}
        </div>
        <div
          role="progressbar"
          aria-label="Workflow progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={view.progress === null ? undefined : Math.round(view.progress)}
          aria-valuetext={progressText(view)}
          className="h-2 overflow-hidden rounded-full bg-surface-hover"
        >
          {/* Scaled, not resized: the eased fill (WP-33) animates only `transform`. */}
          <div
            className="ci-progress-fill h-full w-full origin-left bg-accent"
            style={{ transform: `scaleX(${String((view.progress ?? 0) / 100)})` }}
          />
        </div>
      </div>

      {view.dateChanges.length > 0 && view.canEdit && (
        <div
          role="status"
          className="flex flex-col gap-2 rounded-md border border-warning bg-warning-surface p-3 text-sm"
        >
          <p className="flex items-center gap-1.5 font-medium">
            <CalendarClock aria-hidden="true" className="size-4" />
            Event deadline changed — update stage dates?
          </p>
          <ul className="list-disc pl-5">
            {view.dateChanges.map((change) => (
              <li key={change.stageId}>
                {change.stageName}:{' '}
                {change.current === null ? 'no date' : formatDue(change.current, now)} →{' '}
                {change.proposed === null ? 'no date' : formatDue(change.proposed, now)}
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => {
              void run({
                view,
                path: 'apply-date-changes',
                body: { stageIds: view.dateChanges.map((c) => c.stageId), version: view.version },
                failure: 'The dates were not updated',
              });
            }}
            className="w-fit rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
          >
            Update stage dates
          </button>
        </div>
      )}

      {view.stages.length === 0 ? (
        <p className="text-sm text-fg-muted">
          No stages yet.{view.canEdit ? ' Add the first one below.' : ''}
        </p>
      ) : (
        <ol aria-label="Stages in order" className="flex flex-col gap-2">
          {view.stages.map((stage, index) => (
            <li key={stage.id}>
              <StageCard view={view} stage={stage} index={index} run={run} onMove={move} />
            </li>
          ))}
        </ol>
      )}

      {view.canEdit && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (name.trim() === '') return;
            void run({
              view,
              path: 'stages',
              body: { name: name.trim(), version: view.version },
              failure: 'The stage was not added',
            }).then((saved) => {
              if (saved !== undefined) setName('');
            });
          }}
        >
          <label htmlFor={addId} className="sr-only">
            New stage name
          </label>
          <input
            id={addId}
            value={name}
            maxLength={STAGE_NAME_MAX}
            placeholder="Add a stage"
            onChange={(event) => {
              setName(event.target.value);
            }}
            className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={name.trim() === ''}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add stage
          </button>
        </form>
      )}
    </div>
  );
}
