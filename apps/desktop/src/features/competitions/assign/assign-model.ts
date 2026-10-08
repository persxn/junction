import type { AssignPreview, AssignRequestInput, InitialStatus } from '@compintel/contracts';
import type { ComponentType } from 'react';

import { EMPTY_WORKFLOW_DRAFT, type WorkflowDraft } from '../../workflows/template-choice.js';

/**
 * The assign flow's pure parts (R98, WP-19 step 5): the draft the steps fill
 * in, and how the ordered step array turns into one `AssignRequest`. The array
 * is the extension point — WP-20a inserts "Workflow template" at index 1 and
 * its fragment reaches the request without touching the dialog.
 */

export interface PickedStudent {
  readonly id: string;
  readonly fullName: string;
}

export interface AssignDraft {
  readonly eventId: string;
  readonly eventTitle: string;
  readonly mode: 'TEAM' | 'STUDENTS';
  readonly teamId: string | undefined;
  readonly teamName: string | undefined;
  readonly students: readonly PickedStudent[];
  /** The review step's answer; `canAssign` decides whether Confirm is reachable. */
  readonly preview: AssignPreview | undefined;
  /** WP-20a: the workflow template and the review step's date edits. */
  readonly workflow: WorkflowDraft;
  /** Fields a later step adds to the request (e.g. WP-20a's template id). */
  readonly extra: Readonly<Record<string, unknown>>;
}

export interface StepProps {
  readonly draft: AssignDraft;
  readonly onChange: (patch: Partial<AssignDraft>) => void;
}

export interface AssignStep {
  readonly id: string;
  readonly title: string;
  readonly Component: ComponentType<StepProps>;
  readonly isComplete: (draft: AssignDraft) => boolean;
  /** This step's part of the request. */
  readonly contribute: (draft: AssignDraft) => Readonly<Record<string, unknown>>;
}

export const emptyDraft = (eventId: string, eventTitle: string): AssignDraft => ({
  eventId,
  eventTitle,
  mode: 'TEAM',
  teamId: undefined,
  teamName: undefined,
  students: [],
  preview: undefined,
  workflow: EMPTY_WORKFLOW_DRAFT,
  extra: {},
});

/** "Step 2 of 4" — read from the array, never written by hand. */
export function stepLabel(index: number, steps: readonly AssignStep[]): string {
  return `Step ${String(index + 1)} of ${String(steps.length)}`;
}

/** Every step's fragment, merged in order, plus the event and the chosen start. */
export function requestOf(
  draft: AssignDraft,
  steps: readonly AssignStep[],
  initialStatus: InitialStatus,
): AssignRequestInput {
  const merged = steps.reduce<Record<string, unknown>>(
    (request, step) => ({ ...request, ...step.contribute(draft) }),
    { eventId: draft.eventId },
  );
  return { ...merged, initialStatus } as unknown as AssignRequestInput;
}

/** What the review step asks the server about: the request without a status. */
export function previewRequestOf(draft: AssignDraft): AssignRequestInput | undefined {
  if (draft.mode === 'TEAM') {
    return draft.teamId === undefined
      ? undefined
      : { eventId: draft.eventId, teamId: draft.teamId };
  }
  return draft.students.length === 0
    ? undefined
    : { eventId: draft.eventId, studentIds: draft.students.map((student) => student.id) };
}

/** Inserts a step (WP-20a's seam), leaving the original array untouched. */
export function withStep(
  steps: readonly AssignStep[],
  index: number,
  step: AssignStep,
): AssignStep[] {
  return [...steps.slice(0, index), step, ...steps.slice(index)];
}
