import type { EventType } from '@compintel/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useId } from 'react';

import { listTemplates } from '../../api/workflows.js';
import { Skeleton } from '../../components/Skeleton.js';
import { useBackendConnection } from '../../shell/connection-context.js';
import { problemText } from '../competitions/use-competition-actions.js';
import { offeredTemplates, preselected } from './template-choice.js';

/**
 * "Workflow template" (WP-20a step 6, §11): the department default for the
 * event's type is preselected; every other non-archived template and "Blank
 * workflow" are offered. Shared by the assign flow and the board's
 * Considering → Assigned move.
 */

export const TEMPLATES_KEY = ['workflow-templates'] as const;

export interface TemplatePickerProps {
  readonly eventType: EventType;
  /** `undefined` until a choice is made; the default is chosen on load. */
  readonly value: string | null | undefined;
  readonly onChange: (templateId: string | null) => void;
}

export function TemplatePicker({
  eventType,
  value,
  onChange,
}: TemplatePickerProps): React.JSX.Element {
  const connection = useBackendConnection();
  const group = useId();
  const templates = useQuery({
    queryKey: [...TEMPLATES_KEY, 'list'],
    queryFn: () => listTemplates(connection),
  });
  const items = templates.data?.items;
  useEffect(() => {
    if (value === undefined && items !== undefined) onChange(preselected(items, eventType));
  }, [value, items, eventType, onChange]);

  if (templates.isError) {
    return (
      <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
        The templates did not load: {problemText(templates.error)}
      </p>
    );
  }
  if (items === undefined) return <Skeleton lines={4} label="Loading the workflow templates" />;
  const options = [
    ...offeredTemplates(items, eventType).map((template) => ({
      id: template.id,
      name: template.name,
      hint: `${String(template.stageCount)} stages${
        template.isDefaultForType && template.appliesToEventType === eventType
          ? ' · the department default for this type'
          : template.ownedByMe
            ? ' · yours'
            : ''
      }`,
    })),
    { id: null, name: 'Blank workflow', hint: 'No stages — add your own later' },
  ];
  return (
    <fieldset className="flex flex-col gap-1">
      <legend className="mb-1 text-sm text-fg-muted">
        The stages and tasks are copied now; editing the template later does not change this
        competition.
      </legend>
      <div className="flex max-h-72 flex-col gap-1 overflow-y-auto">
        {options.map((option) => (
          <label
            key={option.id ?? 'blank'}
            className="flex items-start gap-2 rounded-md border border-line px-3 py-2 text-sm has-[:checked]:border-accent"
          >
            <input
              type="radio"
              name={group}
              className="mt-1"
              checked={value === option.id}
              onChange={() => {
                onChange(option.id);
              }}
            />
            <span className="flex flex-col">
              <span className="font-medium">{option.name}</span>
              <span className="text-xs text-fg-muted">{option.hint}</span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
