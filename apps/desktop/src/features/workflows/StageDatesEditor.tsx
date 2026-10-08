import { useQuery } from '@tanstack/react-query';
import { RotateCcw } from 'lucide-react';
import { useId } from 'react';

import { resolveTemplate } from '../../api/workflows.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { useNow } from '../../lib/use-now.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { formatDue } from './format.js';
import { TEMPLATES_KEY } from './TemplatePicker.js';
import { fromZonedInput, toZonedInput, type WorkflowDraft } from './template-choice.js';

/**
 * "Review dates" for the workflow (WP-20a step 6, R100): each stage's date as
 * its rule resolves it for this event, or "No date — set one". Every date is
 * editable; an edited one is the person's (MANUAL) and never recomputed.
 */

export interface StageDatesEditorProps {
  readonly eventId: string;
  readonly draft: WorkflowDraft;
  readonly onChange: (dueOverrides: WorkflowDraft['dueOverrides']) => void;
}

export function StageDatesEditor({
  eventId,
  draft,
  onChange,
}: StageDatesEditorProps): React.JSX.Element | null {
  const connection = useBackendConnection();
  const headingId = useId();
  const now = useNow();
  const templateId = draft.templateId;
  const resolved = useQuery({
    queryKey: [...TEMPLATES_KEY, 'resolve', templateId, eventId],
    queryFn: () => resolveTemplate(connection, templateId ?? '', eventId),
    enabled: typeof templateId === 'string',
  });
  if (typeof templateId !== 'string') {
    return templateId === null ? (
      <p className="text-sm text-fg-muted">
        A blank workflow has no stages yet; add them on the competition’s page.
      </p>
    ) : null;
  }
  if (resolved.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
        The stage dates did not load: {problemText(resolved.error)}
      </p>
    );
  }
  if (resolved.data === undefined) return <Skeleton lines={3} label="Working out stage dates" />;
  const overrides = draft.dueOverrides;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-2">
      <h3 id={headingId} className="font-medium">
        Stage dates — {resolved.data.templateName}
      </h3>
      <ul className="flex flex-col gap-1.5">
        {resolved.data.stages.map((stage) => {
          const edited = Object.hasOwn(overrides, stage.templateStageId);
          const value = edited ? (overrides[stage.templateStageId] ?? null) : stage.dueAt;
          const inputId = `${headingId}-${stage.templateStageId}`;
          return (
            <li
              key={stage.templateStageId}
              className="grid grid-cols-[1fr_auto_auto] items-center gap-2 text-sm"
            >
              <label htmlFor={inputId}>
                {stage.name}
                <span className="block text-xs text-fg-muted">
                  {value === null
                    ? 'No date — set one'
                    : edited
                      ? `Your date: ${formatDue(value, now)}`
                      : `From the event: ${formatDue(value, now)}`}
                </span>
              </label>
              <input
                id={inputId}
                type="datetime-local"
                value={toZonedInput(value)}
                onChange={(event) => {
                  onChange({
                    ...overrides,
                    [stage.templateStageId]: fromZonedInput(event.target.value),
                  });
                }}
                className="rounded-md border border-line bg-surface px-2 py-1"
              />
              {edited ? (
                <button
                  type="button"
                  aria-label={`Use the event’s date for ${stage.name}`}
                  title="Use the event’s date"
                  onClick={() => {
                    const { [stage.templateStageId]: _dropped, ...rest } = overrides;
                    onChange(rest);
                  }}
                  className="rounded-md p-1 hover:bg-surface-hover"
                >
                  <RotateCcw aria-hidden="true" className="size-4" />
                </button>
              ) : (
                <span className="size-6" />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
