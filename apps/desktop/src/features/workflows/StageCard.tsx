import {
  STAGE_STATUSES,
  STAGE_STATUS_LABELS,
  type OpenTaskChoice,
  type StageStatus,
  type WorkflowStage,
  type WorkflowView,
} from '@compintel/contracts';
import { ArrowDown, ArrowUp, CalendarX, Hand, ListChecks, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { useNow } from '../../lib/use-now.js';
import { ResourceRows } from '../resources/ResourceRows.js';
import { formatDue } from './format.js';
import { ItemMenu } from './ItemMenu.js';
import { StageStatusChip } from './labels.js';
import { BlockedReasonDialog, CompleteStageDialog, ConfirmRemoveDialog } from './StageDialogs.js';
import { StageDetails } from './StageDetails.js';
import { TaskList } from './TaskList.js';
import type { RunWrite } from './use-workflow.js';
import { openTaskCount, tasksText, withStage, type Direction } from './workflow-model.js';

/**
 * One stage of a competition's workflow (§16.2, WP-20a step 7): status chip
 * and status choice, due date ("No date — set one"), the derived Overdue
 * badge (never a status), assignees, the "manual" and "Completed with open
 * tasks" markers, the checklist, and the details. The stage's name folds it;
 * Alt+↑/↓ on the name moves it, as do the menu's items.
 */

export const stageDomId = (stageId: string): string => `stage-${stageId}`;

export interface StageCardProps {
  readonly view: WorkflowView;
  readonly stage: WorkflowStage;
  readonly index: number;
  readonly run: RunWrite;
  readonly onMove: (stageId: string, direction: Direction) => void;
}

type Asking = 'BLOCKED' | 'COMPLETED' | 'REMOVE' | undefined;

export function StageCard({ view, stage, index, run, onMove }: StageCardProps): React.JSX.Element {
  const now = useNow();
  const headingId = useId();
  const [asking, setAsking] = useState<Asking>(undefined);
  const [collapsed, setCollapsed] = useState(false);
  const editable = view.canEdit;
  const open = openTaskCount(stage);

  const setStatus = (
    status: StageStatus,
    extra: { blockedReason?: string; openTasks?: OpenTaskChoice } = {},
  ): void => {
    void run({
      view,
      path: `stages/${stage.id}/status`,
      body: { status, ...extra, version: stage.version },
      failure: 'The stage was not updated',
      optimistic: withStage(view, stage.id, (s) => ({
        ...s,
        status,
        blockedReason: extra.blockedReason ?? null,
      })),
    });
  };

  const choose = (status: StageStatus): void => {
    if (status === stage.status) return;
    if (status === 'BLOCKED') setAsking('BLOCKED');
    else if (status === 'COMPLETED' && open > 0) setAsking('COMPLETED');
    else setStatus(status);
  };

  return (
    <section
      aria-labelledby={headingId}
      className="flex flex-col gap-2 rounded-lg border border-line p-3"
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <h3 id={headingId} className="flex flex-wrap items-center gap-2 font-medium">
            <button
              id={stageDomId(stage.id)}
              type="button"
              aria-expanded={!collapsed}
              onClick={() => {
                setCollapsed((value) => !value);
              }}
              aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
              aria-label={`${stage.name}${editable ? ' — Alt+↑ or Alt+↓ moves it' : ''}`}
              onKeyDown={(event) => {
                if (!editable || !event.altKey) return;
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                onMove(stage.id, event.key === 'ArrowUp' ? 'up' : 'down');
              }}
              className="rounded text-left outline-none focus-visible:outline-2 focus-visible:outline-accent"
            >
              {stage.name}
            </button>
            <StageStatusChip status={stage.status} />
            {stage.overdue && (
              <span className="inline-flex items-center gap-1 text-xs text-danger">
                <CalendarX aria-hidden="true" className="size-3.5" />
                Overdue
              </span>
            )}
            {stage.progressOverride !== null && (
              <span className="inline-flex items-center gap-1 text-xs text-fg-muted">
                <Hand aria-hidden="true" className="size-3.5" />
                {stage.progressOverride}% · manual
              </span>
            )}
            {stage.completedWithOpenTasks && (
              <span className="inline-flex items-center gap-1 text-xs text-warning">
                <ListChecks aria-hidden="true" className="size-3.5" />
                Completed with open tasks
              </span>
            )}
          </h3>
          <p className="text-xs text-fg-muted">
            {stage.dueAt === null ? 'No date — set one' : `Due ${formatDue(stage.dueAt, now)}`}
            {' · '}
            {stage.tasks.length > 0 ? tasksText(stage) : 'No tasks'}
            {' · '}
            {stage.progress === null ? 'Not counted' : `${String(Math.round(stage.progress))}%`}
            {stage.assignees.length > 0 &&
              ` · ${stage.assignees.map((person) => person.fullName).join(', ')}`}
          </p>
          {stage.status === 'BLOCKED' && stage.blockedReason !== null && (
            <p className="text-sm text-danger">Blocked: {stage.blockedReason}</p>
          )}
        </div>
        <div className="flex items-center gap-1">
          <label className="sr-only" htmlFor={`${headingId}-status`}>
            Status of {stage.name}
          </label>
          <select
            id={`${headingId}-status`}
            value={stage.status}
            disabled={!editable}
            onChange={(event) => {
              choose(event.target.value as StageStatus);
            }}
            className="rounded-md border border-line bg-surface px-2 py-1 text-sm disabled:opacity-60"
          >
            {STAGE_STATUSES.map((status) => (
              <option key={status} value={status}>
                {STAGE_STATUS_LABELS[status]}
              </option>
            ))}
          </select>
          {editable && (
            <ItemMenu
              name={stage.name}
              items={[
                {
                  label: 'Move up',
                  icon: ArrowUp,
                  disabled: index === 0,
                  onSelect: () => {
                    onMove(stage.id, 'up');
                  },
                },
                {
                  label: 'Move down',
                  icon: ArrowDown,
                  disabled: index === view.stages.length - 1,
                  onSelect: () => {
                    onMove(stage.id, 'down');
                  },
                },
                {
                  label: 'Remove',
                  icon: Trash2,
                  onSelect: () => {
                    setAsking('REMOVE');
                  },
                },
              ]}
            />
          )}
        </div>
      </div>
      {!collapsed && (
        <>
          <TaskList view={view} stage={stage} run={run} />
          <ResourceRows
            ownerKind="STAGE"
            ownerId={stage.id}
            ownerName={stage.name}
            title="Resources"
          />
          <StageDetails view={view} stage={stage} run={run} />
        </>
      )}
      {asking === 'COMPLETED' && (
        <CompleteStageDialog
          stageName={stage.name}
          open={open}
          onAnswer={(answer) => {
            setAsking(undefined);
            if (answer !== undefined) setStatus('COMPLETED', { openTasks: answer });
          }}
        />
      )}
      {asking === 'BLOCKED' && (
        <BlockedReasonDialog
          stageName={stage.name}
          onAnswer={(reason) => {
            setAsking(undefined);
            if (reason !== undefined) setStatus('BLOCKED', { blockedReason: reason });
          }}
        />
      )}
      {asking === 'REMOVE' && (
        <ConfirmRemoveDialog
          what={`the stage “${stage.name}”`}
          detail={`Its ${String(stage.tasks.length)} tasks go with it.`}
          onAnswer={(yes) => {
            setAsking(undefined);
            if (!yes) return;
            void run({
              view,
              path: `stages/${stage.id}/remove`,
              body: { version: view.version },
              failure: 'The stage was not removed',
            });
          }}
        />
      )}
    </section>
  );
}
