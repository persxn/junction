import { useCallback } from 'react';

import { Skeleton } from '../../../components/Skeleton.js';
import { TemplatePicker } from '../../workflows/TemplatePicker.js';
import type { StepProps } from './assign-model.js';
import { useAssignPreview } from './use-assign-preview.js';

/**
 * Step "Workflow template" (WP-20a step 6, §11): the template copied into the
 * competition when it is assigned. Its date edits come on the next step.
 */
export function TemplateStep({ draft, onChange }: StepProps): React.JSX.Element {
  const error = useAssignPreview(draft, onChange);
  const workflow = draft.workflow;
  const choose = useCallback(
    (templateId: string | null) => {
      // A different template has different stages: its date edits start over.
      onChange({ workflow: { templateId, dueOverrides: {} } });
    },
    [onChange],
  );
  if (error !== undefined) {
    return (
      <p role="alert" className="rounded-md bg-danger-surface p-3 text-sm">
        {error}
      </p>
    );
  }
  if (draft.preview === undefined) return <Skeleton lines={4} label="Looking up the event" />;
  return (
    <TemplatePicker
      eventType={draft.preview.event.eventType}
      value={workflow.templateId}
      onChange={(templateId) => {
        if (templateId !== workflow.templateId) choose(templateId);
      }}
    />
  );
}
