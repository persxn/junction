import type { WorkflowTemplateSummary } from '@compintel/contracts';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowLeft, Copy, ListChecks, Star } from 'lucide-react';

import { cloneTemplate, listTemplates } from '../../../api/workflows.js';
import { EmptyState } from '../../../components/EmptyState.js';
import { Guide } from '../../../components/Guide.js';
import { Skeleton } from '../../../components/Skeleton.js';
import { useToast } from '../../../components/toast/ToastProvider.js';
import { useBackendConnection } from '../../../shell/connection-context.js';
import { problemText } from '../../competitions/use-competition-actions.js';
import { DEFAULT_COMPETITIONS_SEARCH } from '../../competitions/search-state.js';
import { EVENT_TYPE_LABELS } from '../../discover/labels.js';
import { TEMPLATES_KEY } from '../TemplatePicker.js';

/**
 * Competitions → Templates (WP-20a step 8, §10.2): the department defaults,
 * your own templates, and other professors' (read-only). Clone any of them to
 * make one of your own; open one to read or edit it.
 */

const GROUPS: readonly [string, (t: WorkflowTemplateSummary) => boolean][] = [
  ['Department defaults', (t) => t.isDepartmentDefault],
  ['Yours', (t) => !t.isDepartmentDefault && t.ownedByMe],
  ['Other professors’', (t) => !t.isDepartmentDefault && !t.ownedByMe],
];

export function TemplatesPage(): React.JSX.Element {
  const connection = useBackendConnection();
  const client = useQueryClient();
  const navigate = useNavigate();
  const toast = useToast();
  const templates = useQuery({
    queryKey: [...TEMPLATES_KEY, 'list'],
    queryFn: () => listTemplates(connection),
  });

  const clone = (template: WorkflowTemplateSummary): void => {
    cloneTemplate(connection, template.id).then(
      (copy) => {
        void client.invalidateQueries({ queryKey: TEMPLATES_KEY });
        toast.show({ tone: 'success', title: `Made “${copy.name}”` });
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
  };

  let body: React.JSX.Element;
  if (templates.isPending) body = <Skeleton lines={6} label="Loading the templates" />;
  else if (templates.isError) {
    body = (
      <EmptyState
        icon={ListChecks}
        title="The templates could not be loaded"
        description={problemText(templates.error)}
        action={{
          label: 'Try again',
          onAction: () => {
            void templates.refetch();
          },
        }}
      />
    );
  } else {
    const live = templates.data.items.filter((t) => !t.isArchived);
    body = (
      <div className="flex flex-col gap-5">
        {GROUPS.map(([title, belongs]) => {
          const items = live.filter(belongs);
          return (
            <section key={title} aria-label={title} className="flex flex-col gap-2">
              <h2 className="text-md">{title}</h2>
              {items.length === 0 ? (
                <p className="text-sm text-fg-muted">
                  {title === 'Yours'
                    ? 'None yet. Clone a template to make one of your own.'
                    : 'None.'}
                </p>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {items.map((template) => (
                    <li
                      key={template.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line px-3 py-2 text-sm"
                    >
                      <div className="flex flex-col">
                        <Link
                          to="/competitions/templates/$templateId"
                          params={{ templateId: template.id }}
                          className="font-medium hover:underline"
                        >
                          {template.name}
                        </Link>
                        <span className="text-xs text-fg-muted">
                          {template.stageCount} stages
                          {template.appliesToEventType !== null &&
                            ` · ${EVENT_TYPE_LABELS[template.appliesToEventType]}`}
                          {template.ownerName !== null &&
                            !template.ownedByMe &&
                            ` · by ${template.ownerName}`}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {template.isDefaultForType && (
                          <span className="inline-flex items-center gap-1 text-xs">
                            <Star aria-hidden="true" className="size-3.5 text-warning" />
                            Preselected for its type
                          </span>
                        )}
                        <button
                          type="button"
                          aria-label={`Clone ${template.name}`}
                          onClick={() => {
                            clone(template);
                          }}
                          className="flex items-center gap-1 rounded-md border border-line px-2 py-1 hover:bg-surface-hover"
                        >
                          <Copy aria-hidden="true" className="size-4" />
                          Clone
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
    );
  }

  return (
    <section aria-labelledby="templates-heading" className="flex flex-col gap-4">
      <Link
        to="/competitions"
        search={DEFAULT_COMPETITIONS_SEARCH}
        className="flex w-fit items-center gap-1 text-sm text-fg-muted hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Competitions
      </Link>
      <h1 id="templates-heading" className="font-display text-xl">
        Workflow templates
      </h1>
      <Guide id="workflow-templates" title="What templates are for">
        <p>
          A template is a list of <strong>stages</strong> — each with a weight, a date rule and a
          few default tasks — copied into a competition when it is assigned. Copies never change
          when the template does.
        </p>
        <p>
          The <strong>department defaults</strong> are preselected for their event type and only an
          admin edits them. <strong>Clone</strong> any template to make one of your own; you can
          edit only the templates you made.
        </p>
        <p>
          A date rule is an anchor and a number of days: “2 days before the registration deadline”.
          When the event has no such date the stage gets none — never a guess.
        </p>
      </Guide>
      {body}
    </section>
  );
}
