import type { AssignStep } from './assign-model.js';
import { ConfirmStep } from './ConfirmStep.js';
import { ReviewStep } from './ReviewStep.js';
import { TeamOrStudentsStep } from './TeamOrStudentsStep.js';

/**
 * The assign flow's steps, in order (R98). WP-20a inserts "Workflow template"
 * at index 1 with one entry here and one request field; the dialog reads its
 * "Step 1 of 3" and its request from this array alone.
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
