import { TASK_TITLE_MAX, type WorkflowStage, type WorkflowView } from '@compintel/contracts';
import { ArrowDown, ArrowUp, Paperclip, Plus, Trash2 } from 'lucide-react';
import { useId, useState } from 'react';

import { useToast } from '../../components/toast/ToastProvider.js';
import { ResourceDialog } from '../resources/ResourceDialog.js';
import { ResourceRows } from '../resources/ResourceRows.js';
import { useResources } from '../resources/ResourcesScope.js';
import { ItemMenu } from './ItemMenu.js';
import { ConfirmRemoveDialog } from './StageDialogs.js';
import type { RunWrite } from './use-workflow.js';
import {
  placementFor,
  reordered,
  withStage,
  withTaskDone,
  type Direction,
} from './workflow-model.js';

/**
 * A stage's checklist (WP-20a step 7): a tick is optimistic and offers Undo;
 * it sends the value, never a toggle. Alt+↑/↓ on a focused task moves it, as
 * do the menu's Move up/down. Removing asks first.
 */

export const taskInputId = (taskId: string): string => `task-${taskId}`;

const refocus = (id: string): void => {
  requestAnimationFrame(() => {
    document.getElementById(id)?.focus();
  });
};

export function TaskList({
  view,
  stage,
  run,
}: {
  readonly view: WorkflowView;
  readonly stage: WorkflowStage;
  readonly run: RunWrite;
}): React.JSX.Element {
  const toast = useToast();
  const addId = useId();
  const [title, setTitle] = useState('');
  const [removing, setRemoving] = useState<WorkflowStage['tasks'][number] | undefined>();
  const [attaching, setAttaching] = useState<WorkflowStage['tasks'][number] | undefined>();
  const resources = useResources();
  // The value just clicked, shown at once: the cache's optimistic copy renders a
  // tick later, and in between a controlled box would flip back (sweep fault).
  const [pending, setPending] = useState<Readonly<Record<string, boolean>>>({});
  const editable = view.canEdit;

  const tick = async (current: WorkflowView, taskId: string, done: boolean, undo = false) => {
    const own = current.stages.find((s) => s.id === stage.id);
    const task = own?.tasks.find((t) => t.id === taskId);
    if (own === undefined || task === undefined) return;
    setPending((current) => ({ ...current, [taskId]: done }));
    const saved = await run({
      view: current,
      path: `tasks/${taskId}/done`,
      body: { done, version: own.version },
      failure: 'The task was not updated',
      optimistic: withTaskDone(current, stage.id, taskId, done),
    });
    setPending(({ [taskId]: _settled, ...rest }) => rest);
    if (saved === undefined || undo) return;
    toast.show({
      tone: 'success',
      title: `${done ? 'Ticked' : 'Unticked'} “${task.title}”`,
      action: {
        label: 'Undo',
        onAction: () => {
          void tick(saved, taskId, !done, true);
        },
      },
    });
  };

  const move = (taskId: string, direction: Direction): void => {
    const placement = placementFor(
      stage.tasks.map((t) => t.id),
      taskId,
      direction,
    );
    if (placement === undefined) return;
    void run({
      view,
      path: `tasks/${taskId}/move`,
      body: { ...placement, version: stage.version },
      failure: 'The task was not moved',
      optimistic: withStage(view, stage.id, (s) => ({
        ...s,
        tasks: reordered(s.tasks, taskId, direction),
      })),
    });
    refocus(taskInputId(taskId));
  };

  return (
    <div className="flex flex-col gap-1">
      {stage.tasks.length === 0 ? (
        <p className="text-sm text-fg-muted">No tasks in this stage.</p>
      ) : (
        <ul aria-label={`Tasks of ${stage.name}`} className="flex flex-col gap-0.5">
          {stage.tasks.map((task, index) => (
            <li
              key={task.id}
              className="flex flex-wrap items-center gap-2 rounded-md px-1 py-0.5 text-sm hover:bg-surface-hover"
              onKeyDown={(event) => {
                if (!editable || !event.altKey) return;
                if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
                event.preventDefault();
                event.stopPropagation();
                move(task.id, event.key === 'ArrowUp' ? 'up' : 'down');
              }}
            >
              <input
                id={taskInputId(task.id)}
                type="checkbox"
                checked={pending[task.id] ?? task.isDone}
                disabled={!editable}
                aria-keyshortcuts={editable ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                onChange={(event) => {
                  void tick(view, task.id, event.target.checked);
                }}
              />
              <label
                htmlFor={taskInputId(task.id)}
                className={`flex-1 ${task.isDone ? 'text-fg-muted line-through' : ''}`}
              >
                {task.title}
                {task.assigneeName !== null && (
                  <span className="text-xs text-fg-muted no-underline"> · {task.assigneeName}</span>
                )}
              </label>
              {editable && (
                <ItemMenu
                  name={task.title}
                  items={[
                    {
                      label: 'Move up',
                      icon: ArrowUp,
                      disabled: index === 0,
                      onSelect: () => {
                        move(task.id, 'up');
                      },
                    },
                    {
                      label: 'Move down',
                      icon: ArrowDown,
                      disabled: index === stage.tasks.length - 1,
                      onSelect: () => {
                        move(task.id, 'down');
                      },
                    },
                    ...(resources?.list?.canEdit === true
                      ? [
                          {
                            label: 'Add a resource',
                            icon: Paperclip,
                            onSelect: () => {
                              setAttaching(task);
                            },
                          },
                        ]
                      : []),
                    {
                      label: 'Remove',
                      icon: Trash2,
                      onSelect: () => {
                        setRemoving(task);
                      },
                    },
                  ]}
                />
              )}
              <div className="basis-full pl-6">
                <ResourceRows
                  ownerKind="TASK"
                  ownerId={task.id}
                  ownerName={task.title}
                  variant="compact"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <form
          className="flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (title.trim() === '') return;
            void run({
              view,
              path: `stages/${stage.id}/tasks`,
              body: { title: title.trim(), version: stage.version },
              failure: 'The task was not added',
            }).then((saved) => {
              if (saved !== undefined) setTitle('');
            });
          }}
        >
          <label htmlFor={addId} className="sr-only">
            New task for {stage.name}
          </label>
          <input
            id={addId}
            value={title}
            maxLength={TASK_TITLE_MAX}
            placeholder="Add a task"
            onChange={(event) => {
              setTitle(event.target.value);
            }}
            className="flex-1 rounded-md border border-line bg-surface px-2 py-1 text-sm"
          />
          <button
            type="submit"
            disabled={title.trim() === ''}
            className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="size-4" />
            Add task
          </button>
        </form>
      )}
      {attaching !== undefined && resources !== undefined && (
        <ResourceDialog
          title={`Add a resource to “${attaching.title}”`}
          shell={resources.shell}
          onClose={() => {
            setAttaching(undefined);
          }}
          onSubmit={(draft) =>
            resources.add({
              ownerKind: 'TASK',
              ownerId: attaching.id,
              uri: draft.uri,
              ...(draft.kind === undefined ? {} : { kind: draft.kind }),
              ...(draft.label === undefined ? {} : { label: draft.label }),
            })
          }
        />
      )}
      {removing !== undefined && (
        <ConfirmRemoveDialog
          what={`the task “${removing.title}”`}
          detail="The task and whether it was done are removed from this stage."
          onAnswer={(yes) => {
            const task = removing;
            setRemoving(undefined);
            if (!yes) return;
            void run({
              view,
              path: `tasks/${task.id}/remove`,
              body: { version: stage.version },
              failure: 'The task was not removed',
            });
          }}
        />
      )}
    </div>
  );
}
