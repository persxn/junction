import {
  EVENT_TYPES,
  STAGE_NAME_MAX,
  TEMPLATE_NAME_MAX,
  type EventType,
  type WorkflowTemplateDetail,
} from '@compintel/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from '@tanstack/react-router';
import { Archive, ArrowLeft, Copy, ListChecks, Plus } from 'lucide-react';
import { useId, useState } from 'react';

import { isApiProblem } from '../../../api/problem.js';
import { cloneTemplate, getTemplate, templateWrite } from '../../../api/workflows.js';
import { useAuth } from '../../../auth/auth-context.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { problemText } from '../../competitions/use-competition-actions.js';
import { EVENT_TYPE_LABELS } from '../../discover/labels.js';
import { ConfirmRemoveDialog } from '../StageDialogs.js';
import { TEMPLATES_KEY } from '../TemplatePicker.js';
import { STALE_TEXT } from '../use-workflow.js';
import { placementFor } from '../workflow-model.js';
import { TemplateStageRow } from './TemplateStageRow.js';

/**
 * One workflow template (WP-20a step 8, §10.2): read by anyone; edited — name,
 * description, event type, stages — by its owner, or by an admin for the
 * department defaults, who alone picks the default for a type. Every edit
 * bumps `versionNo`; a stale one is refused in the house words.
 */

const FIELD = 'rounded-md border border-line bg-surface px-2 py-1.5 text-sm';

export function TemplateEditorPage(): React.JSX.Element {
  const { templateId } = useParams({ from: '/competitions/templates/$templateId' });
  const connection = useBackendConnection();
  const key = [...TEMPLATES_KEY, 'detail', templateId] as const;
  const template = useQuery({ queryKey: key, queryFn: () => getTemplate(connection, templateId) });

  if (template.isPending) return <Skeleton lines={8} label="Loading the template" />;
  if (template.isError) {
    return (
      <EmptyState
        icon={ListChecks}
        title="The template could not be loaded"
        description={problemText(template.error)}
        action={{
          label: 'Try again',
          onAction: () => {
            void template.refetch();
          },
        }}
      />
    );
  }
  return <Editor key={template.data.versionNo} template={template.data} />;
}

function Editor({ template }: { readonly template: WorkflowTemplateDetail }): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const { can } = useAuth();
  const id = useId();
  const [name, setName] = useState(template.name);
  const [description, setDescription] = useState(template.description ?? '');
  const [type, setType] = useState<EventType | ''>(template.appliesToEventType ?? '');
  const [newStage, setNewStage] = useState('');
  const [removing, setRemoving] = useState<string | undefined>(undefined);
  const [archiving, setArchiving] = useState(false);
  const editable = template.canEdit;

  const write = (path: string, method: 'POST' | 'PATCH', body: object, failure: string) =>
    templateWrite(connection, template.id, path, method, {
      ...body,
      versionNo: template.versionNo,
    }).then(
      (saved) => {
        client.setQueryData([...TEMPLATES_KEY, 'detail', template.id], saved);
        void client.invalidateQueries({ queryKey: [...TEMPLATES_KEY, 'list'] });
        return saved;
      },
      (cause: unknown) => {
        const stale = isApiProblem(cause) && cause.code === 'WORKFLOW_VERSION_CONFLICT';
        toast.show({
          tone: stale ? 'warning' : 'danger',
          title: stale ? 'Someone else changed this' : failure,
          description: stale ? STALE_TEXT : problemText(cause),
          ...(stale
            ? {
                action: {
                  label: 'Reload',
                  onAction: () => {
                    void client.invalidateQueries({ queryKey: TEMPLATES_KEY });
                  },
                },
              }
            : {}),
        });
        return undefined;
      },
    );

  const ids = template.stages.map((stage) => stage.id);

  return (
    <section aria-labelledby={`${id}-heading`} className="flex flex-col gap-4">
      <Link
        to="/competitions/templates"
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Workflow templates
      </Link>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 id={`${id}-heading`} className="font-display text-xl">
            {template.name}
          </h1>
          <p className="text-sm text-fg-muted">
            {template.isDepartmentDefault
              ? 'A department default'
              : `By ${template.ownerName ?? 'someone'}`}
            {' · '}version {template.versionNo}
            {template.isArchived && ' · archived'}
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            void cloneTemplate(connection, template.id).then(
              (copy) => {
                void client.invalidateQueries({ queryKey: TEMPLATES_KEY });
                void navigate({
                  to: '/competitions/templates/$templateId',
                  params: { templateId: copy.id },
                });
              },
              (cause: unknown) => {
                toast.show({
                  tone: 'danger',
                  title: 'The template was not copied',
                  description: problemText(cause),
                });
              },
            );
          }}
          className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover"
        >
          <Copy aria-hidden="true" className="size-4" />
          Clone
        </button>
      </header>

      {!editable && (
        <p className="rounded-md border border-line p-3 text-sm text-fg-muted">
          {template.isDepartmentDefault
            ? 'Only an admin changes the department defaults.'
            : 'Only its owner changes this template.'}{' '}
          Clone it to make one of your own.
        </p>
      )}

      {editable && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            void write(
              '',
              'PATCH',
              {
                name: name.trim(),
                description: description.trim() === '' ? null : description.trim(),
                appliesToEventType: type === '' ? null : type,
              },
              'The template was not saved',
            );
          }}
        >
          <label htmlFor={`${id}-name`} className="flex flex-col gap-0.5 text-sm">
            Name
            <input
              id={`${id}-name`}
              value={name}
              maxLength={TEMPLATE_NAME_MAX}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className={FIELD}
            />
          </label>
          <label htmlFor={`${id}-description`} className="flex flex-col gap-0.5 text-sm">
            Description
            <textarea
              id={`${id}-description`}
              rows={2}
              value={description}
              onChange={(e) => {
                setDescription(e.target.value);
              }}
              className={FIELD}
            />
          </label>
          <label htmlFor={`${id}-type`} className="flex flex-col gap-0.5 text-sm">
            For events of type
            <select
              id={`${id}-type`}
              value={type}
              onChange={(e) => {
                setType(e.target.value as EventType | '');
              }}
              className={FIELD}
            >
              <option value="">Any type</option>
              {EVENT_TYPES.map((value) => (
                <option key={value} value={value}>
                  {EVENT_TYPE_LABELS[value]}
                </option>
              ))}
            </select>
          </label>
          {can('workflow_template.manage_all') && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={template.isDefaultForType}
                disabled={template.appliesToEventType === null}
                onChange={(e) => {
                  void write(
                    '',
                    'PATCH',
                    { isDefaultForType: e.target.checked },
                    'The default was not changed',
                  );
                }}
              />
              Preselect it for its event type (admin only)
            </label>
          )}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={name.trim() === ''}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
            >
              Save
            </button>
            {!template.isArchived && (
              <button
                type="button"
                onClick={() => {
                  setArchiving(true);
                }}
                className="flex items-center gap-1 rounded-md border border-line px-3 py-1.5 text-sm hover:bg-surface-hover"
              >
                <Archive aria-hidden="true" className="size-4" />
                Archive
              </button>
            )}
          </div>
        </form>
      )}

      <section aria-labelledby={`${id}-stages`} className="flex flex-col gap-2">
        <h2 id={`${id}-stages`} className="text-md">
          Stages
        </h2>
        {template.stages.length === 0 ? (
          <p className="text-sm text-fg-muted">No stages yet.</p>
        ) : (
          <ol className="flex flex-col gap-2">
            {template.stages.map((stage, index) => (
              <TemplateStageRow
                key={stage.id}
                stage={stage}
                index={index}
                count={template.stages.length}
                editable={editable}
                onSave={(edit) => {
                  void write(`/stages/${stage.id}`, 'PATCH', edit, 'The stage was not saved');
                }}
                onMove={(direction) => {
                  const placement = placementFor(ids, stage.id, direction);
                  if (placement !== undefined)
                    void write(
                      `/stages/${stage.id}/move`,
                      'POST',
                      placement,
                      'The stage was not moved',
                    );
                }}
                onRemove={() => {
                  setRemoving(stage.id);
                }}
              />
            ))}
          </ol>
        )}
        {editable && (
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (newStage.trim() === '') return;
              void write(
                '/stages',
                'POST',
                { name: newStage.trim() },
                'The stage was not added',
              ).then((saved) => {
                if (saved !== undefined) setNewStage('');
              });
            }}
          >
            <label htmlFor={`${id}-new`} className="sr-only">
              New stage name
            </label>
            <input
              id={`${id}-new`}
              value={newStage}
              maxLength={STAGE_NAME_MAX}
              placeholder="Add a stage"
              onChange={(e) => {
                setNewStage(e.target.value);
              }}
              className={`${FIELD} flex-1`}
            />
            <button
              type="submit"
              disabled={newStage.trim() === ''}
              className="flex items-center gap-1 rounded-md border border-line px-2 py-1 text-sm hover:bg-surface-hover disabled:opacity-50"
            >
              <Plus aria-hidden="true" className="size-4" />
              Add stage
            </button>
          </form>
        )}
      </section>

      {removing !== undefined && (
        <ConfirmRemoveDialog
          what={`the stage “${template.stages.find((s) => s.id === removing)?.name ?? ''}”`}
          detail="Competitions already using this template keep their copy."
          onAnswer={(yes) => {
            const stageId = removing;
            setRemoving(undefined);
            if (yes)
              void write(`/stages/${stageId}/remove`, 'POST', {}, 'The stage was not removed');
          }}
        />
      )}
      {archiving && (
        <ConfirmRemoveDialog
          what={`“${template.name}”`}
          verb="Archive"
          detail="An archived template is no longer offered when assigning; competitions using it keep their copy."
          onAnswer={(yes) => {
            setArchiving(false);
            if (yes) void write('/archive', 'POST', {}, 'The template was not archived');
          }}
        />
      )}
    </section>
  );
}
