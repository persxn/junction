import type { CompetitionListItem, WorkflowChoiceInput } from '@compintel/contracts';
import { ArrowLeft, ArrowRight, UserPlus } from 'lucide-react';
import { useState } from 'react';

import { Dialog } from '../../components/Dialog.js';
import { StageDatesEditor } from './StageDatesEditor.js';
import { TemplatePicker } from './TemplatePicker.js';
import { choiceOf, EMPTY_WORKFLOW_DRAFT, type WorkflowDraft } from './template-choice.js';

/**
 * The board's Considering → Assigned (WP-20a step 6, §11): the assign flow's
 * two workflow steps — template, then its dates — before the move, so no
 * assigned competition is without a workflow.
 */

export interface WorkflowChoiceDialogProps {
  readonly item: CompetitionListItem;
  readonly onDone: (choice: WorkflowChoiceInput | undefined) => void;
}

const STEPS = ['Workflow template', 'Review dates'] as const;

export function WorkflowChoiceDialog({
  item,
  onDone,
}: WorkflowChoiceDialogProps): React.JSX.Element {
  const [draft, setDraft] = useState<WorkflowDraft>(EMPTY_WORKFLOW_DRAFT);
  const [index, setIndex] = useState(0);
  const last = index === STEPS.length - 1;
  return (
    <Dialog
      title={`Assign “${item.event.title}”`}
      onClose={() => {
        onDone(undefined);
      }}
      width="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <h3 className="text-sm text-fg-muted">
          <span className="font-medium text-fg">
            Step {index + 1} of {STEPS.length}
          </span>{' '}
          — {STEPS[index]}
        </h3>
        {index === 0 ? (
          <TemplatePicker
            eventType={item.event.eventType}
            value={draft.templateId}
            onChange={(templateId) => {
              if (templateId !== draft.templateId) setDraft({ templateId, dueOverrides: {} });
            }}
          />
        ) : (
          <StageDatesEditor
            eventId={item.event.id}
            draft={draft}
            onChange={(dueOverrides) => {
              setDraft({ ...draft, dueOverrides });
            }}
          />
        )}
        <div className="flex justify-between gap-2">
          <button
            type="button"
            onClick={() => {
              if (index === 0) onDone(undefined);
              else setIndex(0);
            }}
            className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 hover:bg-surface-hover"
          >
            {index > 0 && <ArrowLeft aria-hidden="true" className="size-4" />}
            {index === 0 ? 'Cancel' : 'Back'}
          </button>
          <button
            type="button"
            disabled={draft.templateId === undefined}
            onClick={() => {
              if (last) onDone(choiceOf(draft));
              else setIndex(1);
            }}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover disabled:opacity-50"
          >
            {last ? (
              <>
                <UserPlus aria-hidden="true" className="size-4" />
                Assign
              </>
            ) : (
              <>
                Next
                <ArrowRight aria-hidden="true" className="size-4" />
              </>
            )}
          </button>
        </div>
      </div>
    </Dialog>
  );
}
