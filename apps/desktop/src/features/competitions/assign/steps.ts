import type { AssignStep } from './assign-model.js';
import { ConfirmStep } from './ConfirmStep.js';
import { choiceOf } from '../../workflows/template-choice.js';
import { ReviewStep } from './ReviewStep.js';
import { TeamOrStudentsStep } from './TeamOrStudentsStep.js';
import { TemplateStep } from './TemplateStep.js';

/**
 * The assign flow's steps, in order (R98): team or students → workflow
 * template (WP-20a, index 1) → review dates → confirm. The dialog reads its
 * "Step 1 of 4" and its request from this array alone.
 */
export const ASSIGN_STEPS: readonly AssignStep[] = [
  {
    id: 'who',
    title: 'Team or students',
    Component: TeamOrStudentsStep,
    isComplete: (draft) =>
      draft.mode === 'TEAM' ? draft.teamId !== undefined : draft.students.length > 0,
    contribute: (draft) =>
      draft.mode === 'TEAM'
        ? { teamId: draft.teamId }
        : { studentIds: draft.students.map((student) => student.id) },
  },
  {
    id: 'template',
    title: 'Workflow template',
    Component: TemplateStep,
    isComplete: (draft) => draft.workflow.templateId !== undefined,
    contribute: (draft) => {
      const workflow = choiceOf(draft.workflow);
      return workflow === undefined ? {} : { workflow };
    },
  },
  {
    id: 'review',
    title: 'Review dates',
    Component: ReviewStep,
    isComplete: (draft) => draft.preview?.canAssign === true,
    contribute: () => ({}),
  },
  {
    id: 'confirm',
    title: 'Confirm',
    Component: ConfirmStep,
    isComplete: () => true,
    contribute: () => ({}),
  },
];
